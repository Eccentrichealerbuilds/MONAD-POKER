// Secure backend for Monad Poker integration
// Provides HMAC + API key protected endpoints for score submissions

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { BaseError, createPublicClient, createWalletClient, http, isAddress, type Hash, decodeEventLog } from 'viem';
import { monadTestnet } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { LEADERBOARD_ABI } from './leaderboardAbi';
import { MONAD_POKER_GAME_ABI } from './monadPokerGameAbi';

const app = express();
const port = process.env.PORT || 4000;

// Configuration
const API_SECRET = process.env.API_SECRET || '';
const CLIENT_API_SECRET = process.env.VITE_CLIENT_API_SECRET || process.env.NEXT_PUBLIC_CLIENT_API_SECRET || '';
const HMAC_SECRET = (process.env.HMAC_SECRET || '').trim();
const ALLOWED_ORIGIN = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || '';
const RPC_URL = process.env.RPC_URL || 'https://testnet-rpc.monad.xyz';
const PRIVATE_KEY = (process.env.WALLET_PRIVATE_KEY || process.env.PRIVATE_KEY || '').trim();
const ENABLE_UPDATE_ENDPOINT = String(process.env.ENABLE_UPDATE_ENDPOINT || '').toLowerCase() === 'true';
const ENABLE_BATCH_ENDPOINT = String(process.env.ENABLE_BATCH_ENDPOINT || 'true').toLowerCase() === 'true';
const JSON_LIMIT = process.env.JSON_LIMIT || '32kb';
const TRUST_PROXY = String(process.env.TRUST_PROXY || '');
const ALLOWED_ORIGINS = (ALLOWED_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
const GAME_CONTRACT_ADDRESS = (process.env.GAME_CONTRACT_ADDRESS || '') as `0x${string}`;

// Leaderboard (official universal Monad game id) config
const LEADERBOARD_ADDRESS = (process.env.LEADERBOARD_CONTRACT_ADDRESS || '0xceCBFF203C8B6044F52CE23D914A1bfD997541A4') as `0x${string}`;
const LEADERBOARD_FROM_BLOCK_STR = (process.env.LEADERBOARD_FROM_BLOCK || '').trim();
const LEADERBOARD_FROM_BLOCK: bigint = /^[0-9]+$/.test(LEADERBOARD_FROM_BLOCK_STR) ? BigInt(LEADERBOARD_FROM_BLOCK_STR) : 0n;
const LEADERBOARD_CACHE_TTL_MS = Number(process.env.LEADERBOARD_CACHE_TTL_MS || 15000);
const LEADERBOARD_READ_CONCURRENCY = Number(process.env.LEADERBOARD_READ_CONCURRENCY || 12);
const LEADERBOARD_SNAPSHOT_PATH = process.env.LEADERBOARD_SNAPSHOT_PATH || path.join(process.cwd(), 'data', 'leaderboard.json');
const LEADERBOARD_INDEX_POLL_INTERVAL_MS = Number(process.env.LEADERBOARD_INDEX_POLL_INTERVAL_MS || 30000);
const LEADERBOARD_INDEX_CHUNK_BLOCKS = Number(process.env.LEADERBOARD_INDEX_CHUNK_BLOCKS || 10000);
const LEADERBOARD_INDEXER_ENABLED = String(process.env.LEADERBOARD_INDEXER_ENABLED || 'false').toLowerCase() === 'true';
const RECENT_HANDS_SIZE = Number(process.env.RECENT_HANDS_SIZE || 100);
const SEARCH_CACHE_TTL_MS = Number(process.env.SEARCH_CACHE_TTL_MS || 15000);

// Preselect event from ABI for efficient log filters
const PLAYER_DATA_UPDATED_EVENT = (LEADERBOARD_ABI as readonly any[]).find((i: any) => i.type === 'event' && i.name === 'PlayerDataUpdated');

// Known players registry persisted to disk for direct contract reads
const knownPlayers = new Set<string>();
let lastProcessedBlock: bigint = LEADERBOARD_FROM_BLOCK;
type LeaderboardItem = { player: string; score: string; transactions: string };
let snapshotBootItems: LeaderboardItem[] | null = null;
let snapshotBootItemsUpdatedAt: string | null = null;
type TotalsEntry = { score: string; transactions: string };
const localTotals: Record<string, TotalsEntry> = Object.create(null);
type RecentHand = { handId: string; tableId: string; deckHash: string; requestId: string; players: string[]; winners: boolean[]; timestamp: number };
let recentHands: RecentHand[] = [];

async function loadSnapshot() {
  try {
    const raw = await fs.readFile(LEADERBOARD_SNAPSHOT_PATH, 'utf8');
    const data = JSON.parse(raw);
    if (Array.isArray(data?.knownPlayers)) {
      for (const a of data.knownPlayers) if (isAddress(a)) knownPlayers.add(a);
    }
    if (data && data.lastProcessedBlock !== undefined && data.lastProcessedBlock !== null) {
      try {
        const v = BigInt(String(data.lastProcessedBlock));
        if (v >= 0) lastProcessedBlock = v;
      } catch {}
    }
    if (Array.isArray(data?.lastItems)) {
      snapshotBootItems = (data.lastItems as any[]).filter((x: any) => x && isAddress(String(x.player || '')));
    }
    if (typeof data?.lastItemsUpdatedAt === 'string') {
      snapshotBootItemsUpdatedAt = data.lastItemsUpdatedAt as string;
    }
    if (data && typeof (data as any).localTotals === 'object' && (data as any).localTotals) {
      const lt: any = (data as any).localTotals;
      for (const k of Object.keys(lt)) {
        if (isAddress(k)) {
          const v: any = lt[k];
          const score = v && v.score !== undefined && v.score !== null ? String(v.score) : '0';
          const txs = v && v.transactions !== undefined && v.transactions !== null ? String(v.transactions) : '0';
          localTotals[k] = { score, transactions: txs };
        }
      }
    }
    if (Array.isArray((data as any)?.recentHands)) {
      const arr: any[] = (data as any).recentHands as any[];
      recentHands = arr
        .filter(h => h && Array.isArray(h.players) && Array.isArray(h.winners) && typeof h.timestamp === 'number')
        .slice(-RECENT_HANDS_SIZE);
    }
  } catch (_e) {
    // ignore if file missing or invalid
  }
}

async function saveSnapshot(opts?: { lastItems?: LeaderboardItem[]; lastItemsUpdatedAt?: string }) {
  try {
    await fs.mkdir(path.dirname(LEADERBOARD_SNAPSHOT_PATH), { recursive: true });
    const payload = {
      knownPlayers: Array.from(knownPlayers),
      lastProcessedBlock: lastProcessedBlock?.toString?.() || '0',
      updatedAt: new Date().toISOString(),
      localTotals,
      recentHands,
      ...(opts?.lastItems ? { lastItems: opts.lastItems, lastItemsUpdatedAt: opts.lastItemsUpdatedAt || new Date().toISOString() } : {})
    };
    await fs.writeFile(LEADERBOARD_SNAPSHOT_PATH, JSON.stringify(payload, null, 2), 'utf8');
  } catch (_e) {
    // ignore write errors
  }
}

// Build HMAC headers for a given JSON body using server secret
function buildHmacHeaders(body: any) {
  if (!HMAC_SECRET) throw new Error('HMAC secret not configured');
  const ts = Math.floor(Date.now() / 1000).toString();
  const nonce = `0x${crypto.randomBytes(32).toString('hex')}`;
  const raw = Buffer.from(JSON.stringify(body));
  const bodyHashHex = sha256Hex(raw);
  const payload = `v1:${ts}:${nonce}:${bodyHashHex}`;
  const signature = crypto.createHmac('sha256', Buffer.from(HMAC_SECRET, 'utf8')).update(payload).digest('hex');
  return {
    'x-timestamp': ts,
    'x-nonce': nonce,
    'x-signature': `0x${signature}`
  } as Record<string, string>;
}

async function addKnownPlayers(addrs: string[]) {
  let changed = false;
  for (const addr of addrs || []) {
    if (isAddress(addr) && !knownPlayers.has(addr)) {
      knownPlayers.add(addr);
      changed = true;
    }
  }
  if (changed) await saveSnapshot();
}

function bumpLocalTotals(players: string[], winners: boolean[]) {
  try {
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      if (!isAddress(p)) continue;
      const existing = localTotals[p] || { score: '0', transactions: '0' };
      const nextTx = (BigInt(existing.transactions) + 1n).toString();
      const nextScore = (BigInt(existing.score) + (winners[i] ? 1n : 0n)).toString();
      localTotals[p] = { score: nextScore, transactions: nextTx };
    }
  } catch {}
}

function appendRecentHand(entry: RecentHand) {
  recentHands.push(entry);
  if (recentHands.length > RECENT_HANDS_SIZE) {
    recentHands = recentHands.slice(-RECENT_HANDS_SIZE);
  }
}

const account = PRIVATE_KEY ? privateKeyToAccount(`0x${PRIVATE_KEY.replace(/^0x/, '')}` as `0x${string}`) : undefined;
const publicClient = createPublicClient({ chain: monadTestnet, transport: http(RPC_URL) });
const walletClient = account ? createWalletClient({ account, chain: monadTestnet, transport: http(RPC_URL) }) : undefined;
// The per-game identity for leaderboard accounting. When writing directly, the game is msg.sender.
// Prefer explicit GAME_ADDRESS from env; otherwise default to GAME_CONTRACT_ADDRESS, else backend wallet EOA.
const GAME_ADDRESS = ((process.env.GAME_ADDRESS || process.env.GAME_CONTRACT_ADDRESS || account?.address) || '') as `0x${string}`;

app.disable('x-powered-by');
if (TRUST_PROXY === '1' || TRUST_PROXY.toLowerCase() === 'true') {
  app.set('trust proxy', 1);
}

// Middleware
app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.length === 0) return callback(new Error('Not allowed by CORS'));
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS']
}));
// Capture raw body for HMAC signing while still parsing JSON
app.use(express.json({
  limit: JSON_LIMIT,
  verify: (req, _res, buf) => {
    (req as any).rawBody = buf;
  }
}));

// Simple in-memory rate limiter
const RATE_MAX = Number(process.env.RATE_LIMIT_MAX || 20);
const RATE_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000);
class RateLimiter {
  private store = new Map<string, { count: number; resetAt: number }>();
  isAllowed(key: string) {
    const now = Date.now();
    const entry = this.store.get(key);
    if (!entry || now > entry.resetAt) {
      this.store.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
      return { allowed: true, remaining: RATE_MAX - 1, retryAfter: 0 };
    }
    if (entry.count >= RATE_MAX) {
      return { allowed: false, remaining: 0, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
    }
    entry.count += 1;
    this.store.set(key, entry);
    return { allowed: true, remaining: RATE_MAX - entry.count, retryAfter: 0 };
  }
}
const rateLimiter = new RateLimiter();

// Load known players at startup (non-blocking) and warm cache if snapshot had items
const snapshotLoadPromise = loadSnapshot();
snapshotLoadPromise.then(() => {
  if (snapshotBootItems && snapshotBootItemsUpdatedAt) {
    leaderboardCache = {
      ts: Date.now(),
      payload: {
        ok: true,
        game: GAME_ADDRESS,
        leaderboardContract: LEADERBOARD_ADDRESS,
        totalPlayers: knownPlayers.size,
        count: snapshotBootItems.length,
        items: snapshotBootItems,
        updatedAt: snapshotBootItemsUpdatedAt
      }
    };
  } else if (Object.keys(localTotals).length > 0) {
    const items = Object.entries(localTotals)
      .map(([player, t]) => ({ player, score: t.score, transactions: t.transactions }))
      .sort((a, b) => {
        const ds = BigInt(b.score) - BigInt(a.score);
        if (ds !== 0n) return ds > 0n ? 1 : -1;
        const dt = BigInt(b.transactions) - BigInt(a.transactions);
        return dt > 0n ? 1 : dt < 0n ? -1 : 0;
      });
    leaderboardCache = {
      ts: Date.now(),
      payload: {
        ok: true,
        game: GAME_ADDRESS,
        leaderboardContract: LEADERBOARD_ADDRESS,
        totalPlayers: Object.keys(localTotals).length,
        count: items.length,
        items,
        updatedAt: new Date().toISOString()
      }
    };
  }
}).catch(() => {});

// Background incremental indexer: scans PlayerDataUpdated logs and maintains knownPlayers + lastProcessedBlock
let indexing = false;
async function runIndexerOnce() {
  if (indexing) return;
  indexing = true;
  try {
    if (!PLAYER_DATA_UPDATED_EVENT) return; // ABI missing event
    if (!isAddress(GAME_ADDRESS)) return; // invalid game identity
    if (!isAddress(LEADERBOARD_ADDRESS)) return;

    const head = await publicClient.getBlockNumber();
    // Determine next from block (exclusive -> inclusive)
    let from: bigint = lastProcessedBlock > 0n ? lastProcessedBlock + 1n : (LEADERBOARD_FROM_BLOCK > 0n ? LEADERBOARD_FROM_BLOCK : 0n);
    if (from > head) return; // up-to-date

    const chunkSize = BigInt(Math.max(1, LEADERBOARD_INDEX_CHUNK_BLOCKS | 0));
    while (from <= head) {
      const to = from + chunkSize - 1n <= head ? from + chunkSize - 1n : head;
      try {
        const logs = await publicClient.getLogs({
          address: LEADERBOARD_ADDRESS,
          event: PLAYER_DATA_UPDATED_EVENT as any,
          args: { game: GAME_ADDRESS },
          fromBlock: from,
          toBlock: to
        });
        let changed = false;
        for (const l of logs) {
          const a = (l as any).args || {};
          const player = (a.player || '').toString();
          if (isAddress(player) && !knownPlayers.has(player)) {
            knownPlayers.add(player);
            changed = true;
          }
        }
        lastProcessedBlock = to;
        if (changed) await saveSnapshot();
      } catch (_e) {
        // swallow and break to avoid tight loops on RPC errors
        break;
      }
      from = to + 1n;
    }
    // Always persist lastProcessedBlock progression
    await saveSnapshot();
  } finally {
    indexing = false;
  }
}

// Kick off periodic indexing (disabled by default)
if (LEADERBOARD_INDEXER_ENABLED) {
  setInterval(() => { void runIndexerOnce(); }, Math.max(5000, LEADERBOARD_INDEX_POLL_INTERVAL_MS | 0));
  // Best-effort initial catch-up shortly after boot
  setTimeout(() => { void runIndexerOnce(); }, 1500);
}

// Request deduplication cache
type CacheEntry = { status: 'processing' | 'done'; result?: any; error?: any; ts: number };
const dedupCache = new Map<string, CacheEntry>();

// Serialize contract writes to avoid nonce collisions when many requests arrive at once
class AsyncQueue {
  private q: Array<() => Promise<void>> = [];
  private running = false;
  enqueue<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.q.push(async () => {
        try {
          const out = await task();
          resolve(out);
        } catch (e) {
          reject(e);
        }
      });
      if (!this.running) this.run();
    });
  }
  private async run() {
    this.running = true;
    try {
      while (this.q.length) {
        const job = this.q.shift();
        if (!job) continue;
        try { await job(); } catch (_e) { /* already rejected to caller */ }
      }
    } finally {
      this.running = false;
    }
  }
}
const txQueue = new AsyncQueue();

function validateOrigin(origin: string | undefined) {
  if (!origin) return true; // allow server-to-server clients
  if (ALLOWED_ORIGINS.length === 0) return false;
  return ALLOWED_ORIGINS.includes(origin);
}

function validateApiKey(key: string | undefined) {
  if (!key) return false;
  const validKeys = [API_SECRET, CLIENT_API_SECRET].filter(Boolean);
  if (!validKeys.length) return false;
  return validKeys.includes(key);
}

// Server-only API key validator (does NOT accept client public key)
function validateServerApiKey(key: string | undefined) {
  if (!key) return false;
  if (!API_SECRET) return false;
  return key === API_SECRET;
}

// Helpers for HMAC verification
const MAX_SKEW_SECONDS = Number(process.env.HMAC_MAX_SKEW_SECONDS || 60);
function isBytes32(v: string | undefined) {
  return !!v && /^0x[0-9a-fA-F]{64}$/.test(v);
}
function sha256Hex(buf: Buffer | string) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}
// Deterministic bytes32 from an arbitrary string using sha256 (sufficient for IDs)
function toBytes32FromString(s: string) {
  return (`0x${sha256Hex(Buffer.from(s, 'utf8'))}`) as `0x${string}`;
}
function verifyHmac(req: express.Request): { ok: boolean; error?: string } {
  if (!HMAC_SECRET) return { ok: false, error: 'HMAC secret not configured' };
  const tsStr = (req.get('x-timestamp') || '').trim();
  const nonce = (req.get('x-nonce') || '').trim();
  const sig = (req.get('x-signature') || '').trim(); // expected hex without 0x or with 0x
  if (!tsStr || !nonce || !sig) return { ok: false, error: 'Missing HMAC headers' };
  const ts = Number(tsStr);
  if (!Number.isFinite(ts)) return { ok: false, error: 'Invalid timestamp' };
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - ts) > MAX_SKEW_SECONDS) return { ok: false, error: 'Stale timestamp' };
  const raw = (req as any).rawBody as Buffer | undefined;
  if (!raw) return { ok: false, error: 'Missing raw body' };
  const bodyHashHex = sha256Hex(raw);
  const payload = `v1:${ts}:${nonce}:${bodyHashHex}`;
  const expected = crypto.createHmac('sha256', Buffer.from(HMAC_SECRET, 'utf8')).update(payload).digest('hex');
  const normalizedSig = sig.startsWith('0x') ? sig.slice(2) : sig;
  if (!crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(normalizedSig, 'hex'))) {
    return { ok: false, error: 'Bad signature' };
  }
  return { ok: true };
}

function parseAmount(value: any, field: string): bigint {
  if (value === undefined || value === null) throw new Error(`Missing required field: ${field}`);
  try {
    const n = BigInt(String(value));
    if (n < 0n) throw new Error(`${field} must be non-negative`);
    return n;
  } catch {
    throw new Error(`Invalid ${field}`);
  }
}

// Browser-facing proxy: signs body with server HMAC and forwards to secure endpoint
app.post('/api/client/update-player-data', async (req, res) => {
  try {
    if (!ENABLE_UPDATE_ENDPOINT) {
      return res.status(404).json({ ok: false, error: 'Endpoint disabled' });
    }
    const origin = req.get('origin') || '';
    if (!validateOrigin(origin)) {
      return res.status(403).json({ ok: false, error: 'Invalid origin' });
    }

    // Validate client API key if configured (public client key)
    if (CLIENT_API_SECRET) {
      const headerKey = (req.get('x-api-key') || '').trim();
      const bearerKey = (req.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
      const clientKey = headerKey || bearerKey;
      if (clientKey !== CLIENT_API_SECRET) {
        return res.status(401).json({ ok: false, error: 'Unauthorized' });
      }
    }

    const rl = rateLimiter.isAllowed(req.ip || 'global');
    res.setHeader('X-RateLimit-Limit', String(RATE_MAX));
    res.setHeader('X-RateLimit-Remaining', String(rl.remaining));
    if (!rl.allowed) {
      res.setHeader('Retry-After', String(rl.retryAfter));
      return res.status(429).json({ ok: false, error: 'Too many requests' });
    }

    const { player, playerAddress, scoreAmount, score, scoreDelta, transactionAmount, txAmount, transactions } = req.body || {};
    const body = {
      playerAddress: player || playerAddress,
      scoreAmount: scoreAmount ?? score ?? scoreDelta,
      transactionAmount: transactionAmount ?? txAmount ?? transactions,
    } as any;

    if (!isAddress(String(body.playerAddress || ''))) {
      return res.status(400).json({ ok: false, error: 'Invalid player address' });
    }

    const url = `http://127.0.0.1:${port}/api/update-player-data`;
    const rid = (req.get('x-request-id') || req.body?.requestId || '').toString();
    const hmacHeaders = buildHmacHeaders(body);
    const upstream = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': API_SECRET,
        ...(rid ? { 'x-request-id': rid } : {}),
        ...hmacHeaders,
      },
      body: JSON.stringify(body),
    } as any);

    const text = await upstream.text();
    let data: any;
    try { data = JSON.parse(text); } catch { data = { ok: false, error: text || 'Invalid upstream response' }; }
    return res.status(upstream.status).json(data);
  } catch (err: any) {
    const msg = (err as BaseError)?.shortMessage || err?.message || String(err);
    return res.status(500).json({ ok: false, error: msg });
  }
});

// Browser-facing proxy for batched hand submission
app.post('/api/client/submit-hand-batch', async (req, res) => {
  try {
    if (!ENABLE_BATCH_ENDPOINT) {
      return res.status(404).json({ ok: false, error: 'Endpoint disabled' });
    }
    const origin = req.get('origin') || '';
    if (!validateOrigin(origin)) {
      return res.status(403).json({ ok: false, error: 'Invalid origin' });
    }

    // Validate client API key if configured (public client key)
    if (CLIENT_API_SECRET) {
      const headerKey = (req.get('x-api-key') || '').trim();
      const bearerKey = (req.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
      const clientKey = headerKey || bearerKey;
      if (clientKey !== CLIENT_API_SECRET) {
        return res.status(401).json({ ok: false, error: 'Unauthorized' });
      }
    }

    const rl = rateLimiter.isAllowed(req.ip || 'global');
    res.setHeader('X-RateLimit-Limit', String(RATE_MAX));
    res.setHeader('X-RateLimit-Remaining', String(rl.remaining));
    if (!rl.allowed) {
      res.setHeader('Retry-After', String(rl.retryAfter));
      return res.status(429).json({ ok: false, error: 'Too many requests' });
    }

    const { players, winners, roomId, handSeq, handId, tableId, deckHash, requestId } = req.body || {};
    const body: any = { players, winners, roomId, handSeq, handId, tableId, deckHash, requestId };

    const url = `http://127.0.0.1:${port}/api/submit-hand-batch`;
    const rid = (req.get('x-request-id') || requestId || '').toString();
    const hmacHeaders = buildHmacHeaders(body);
    const upstream = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': API_SECRET,
        ...(rid ? { 'x-request-id': rid } : {}),
        ...hmacHeaders,
      },
      body: JSON.stringify(body),
    } as any);

    const text = await upstream.text();
    let data: any;
    try { data = JSON.parse(text); } catch { data = { ok: false, error: text || 'Invalid upstream response' }; }
    return res.status(upstream.status).json(data);
  } catch (err: any) {
    const msg = (err as BaseError)?.shortMessage || err?.message || String(err);
    return res.status(500).json({ ok: false, error: msg });
  }
});

// Secure batched hand submission (server-to-server)
app.post('/api/submit-hand-batch', async (req, res) => {
  try {
    if (!ENABLE_BATCH_ENDPOINT) {
      return res.status(404).json({ ok: false, error: 'Endpoint disabled' });
    }
    // Origin validation
    const origin = req.get('origin') || '';
    if (!validateOrigin(origin)) {
      return res.status(403).json({ ok: false, error: 'Invalid origin' });
    }

    // API key (server-only) + HMAC validation
    const headerKey = (req.get('x-api-key') || '').trim();
    const bearerKey = (req.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
    const apiKey = headerKey || bearerKey;
    if (!validateServerApiKey(apiKey)) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    const h = verifyHmac(req);
    if (!h.ok) {
      return res.status(401).json({ ok: false, error: `HMAC: ${h.error}` });
    }

    // Rate limiting
    const rl = rateLimiter.isAllowed(req.ip || 'global');
    res.setHeader('X-RateLimit-Limit', String(RATE_MAX));
    res.setHeader('X-RateLimit-Remaining', String(rl.remaining));
    if (!rl.allowed) {
      res.setHeader('Retry-After', String(rl.retryAfter));
      return res.status(429).json({ ok: false, error: 'Too many requests' });
    }

    // Request dedup
    const incomingRid = (req.get('x-request-id') || req.body?.requestId || '').toString();
    if (incomingRid) {
      const existing = dedupCache.get(incomingRid);
      if (existing) {
        if (existing.status === 'done') return res.status(200).json(existing.result || existing.error || { ok: true });
        return res.status(409).json({ ok: false, error: 'Duplicate request in progress' });
      }
      dedupCache.set(incomingRid, { status: 'processing', ts: Date.now() });
    }

    // Validate config
    if (!walletClient || !account) {
      throw new Error('Backend wallet not configured');
    }
    if (!GAME_CONTRACT_ADDRESS || !isAddress(GAME_CONTRACT_ADDRESS)) {
      throw new Error('Invalid game contract address');
    }

    // Body validation
    const { players, winners, roomId, handSeq } = req.body || {};
    let { handId, tableId, deckHash, requestId } = (req.body || {}) as any;
    const playersArr: string[] = Array.isArray(players) ? players : [];
    const winnersArr: boolean[] = Array.isArray(winners) ? winners.map((x: any) => !!x) : [];
    if (!playersArr.length) throw new Error('Missing players');
    if (playersArr.length !== winnersArr.length) throw new Error('players/winners length mismatch');
    for (let i = 0; i < playersArr.length; i++) {
      if (!isAddress(playersArr[i])) throw new Error(`Invalid player address at index ${i}`);
    }

    // Normalize IDs from roomId/handSeq when not provided as bytes32
    const roomStr = String(roomId || '').trim();
    const handSeqStr = String(handSeq ?? '').trim();
    if (!isBytes32(handId)) handId = toBytes32FromString(`hand:${roomStr}:${handSeqStr}`);
    if (!isBytes32(tableId)) tableId = toBytes32FromString(`table:${roomStr}`);
    if (!isBytes32(deckHash)) deckHash = toBytes32FromString(`deck:${roomStr}:${handSeqStr}`);
    if (!isBytes32(requestId)) requestId = toBytes32FromString(`req:${GAME_CONTRACT_ADDRESS}:${roomStr}:${handSeqStr}`);

    // Contract write via queue to serialize nonces
    const { txHash, receipt } = await txQueue.enqueue(async () => {
      const txHash = await walletClient.writeContract({
        address: GAME_CONTRACT_ADDRESS,
        abi: MONAD_POKER_GAME_ABI,
        functionName: 'submitHandResult',
        args: [playersArr as unknown as `0x${string}`[], winnersArr, handId as `0x${string}`, tableId as `0x${string}`, deckHash as `0x${string}`, requestId as `0x${string}`],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash as Hash });
      return { txHash, receipt } as const;
    });

    // Update local caches best-effort
    void addKnownPlayers(playersArr);
    try { bumpLocalTotals(playersArr, winnersArr); } catch {}
    try {
      appendRecentHand({
        handId: String(handId),
        tableId: String(tableId),
        deckHash: String(deckHash),
        requestId: String(requestId),
        players: playersArr,
        winners: winnersArr,
        timestamp: Math.floor(Date.now() / 1000)
      });
    } catch {}

    // After on-chain write, verify universal + per-game stats for involved players
    let postStats: Array<{
      player: string;
      totalScore: string;
      totalTransactions: string;
      perGame: { score: string; transactions: string };
    }> = [];
    try {
      const stats = await Promise.all(
        playersArr.map(async (p) => {
          try {
            const [totalScore, totalTxs] = await Promise.all([
              publicClient.readContract({
                address: LEADERBOARD_ADDRESS,
                abi: LEADERBOARD_ABI,
                functionName: 'totalScoreOfPlayer',
                args: [p as `0x${string}`],
              }) as Promise<bigint>,
              publicClient.readContract({
                address: LEADERBOARD_ADDRESS,
                abi: LEADERBOARD_ABI,
                functionName: 'totalTransactionsOfPlayer',
                args: [p as `0x${string}`],
              }) as Promise<bigint>,
            ]);

            const perGame = await publicClient.readContract({
              address: LEADERBOARD_ADDRESS,
              abi: LEADERBOARD_ABI,
              functionName: 'playerDataPerGame',
              args: [GAME_ADDRESS, p as `0x${string}`],
            }) as readonly [bigint, bigint];
            const [pgScore, pgTxs] = perGame || [0n, 0n];

            return {
              player: p,
              totalScore: (totalScore ?? 0n).toString(),
              totalTransactions: (totalTxs ?? 0n).toString(),
              perGame: { score: pgScore.toString(), transactions: pgTxs.toString() },
            };
          } catch {
            return { player: p, totalScore: '0', totalTransactions: '0', perGame: { score: '0', transactions: '0' } };
          }
        })
      );
      postStats = stats;
    } catch {}

    const payload = {
      ok: true,
      txHash,
      receipt: {
        transactionHash: receipt.transactionHash,
        blockNumber: receipt.blockNumber?.toString?.() ?? String(receipt.blockNumber),
        status: receipt.status,
      },
      leaderboard: {
        contract: LEADERBOARD_ADDRESS,
        game: GAME_ADDRESS,
        players: postStats,
      },
    };

    if (incomingRid) dedupCache.set(incomingRid, { status: 'done', ts: Date.now(), result: payload });
    return res.status(200).json(payload);
  } catch (err: any) {
    const msg = (err as BaseError)?.shortMessage || err?.message || String(err);
    const l = msg.toLowerCase();
    let code = 500;
    if (l.includes('insufficient') && l.includes('fund')) code = 402;
    else if (l.includes('unauthorized') || l.includes('accesscontrol')) code = 403;
    else if (l.includes('invalid') || l.includes('missing') || l.includes('mismatch')) code = 400;
    // Store error in dedup cache to avoid stuck 'processing'
    const rid = (req.get('x-request-id') || req.body?.requestId || '').toString();
    if (rid) dedupCache.set(rid, { status: 'done', ts: Date.now(), error: { code, message: msg } });
    return res.status(code).json({ ok: false, error: msg });
  }
});

// Secure score submission endpoint
app.post('/api/update-player-data', async (req, res) => {
  try {
    if (!ENABLE_UPDATE_ENDPOINT) {
      return res.status(404).json({ ok: false, error: 'Endpoint disabled' });
    }
    // Origin validation
    const origin = req.get('origin') || '';
    if (!validateOrigin(origin)) {
      return res.status(403).json({ ok: false, error: 'Invalid origin' });
    }

    // API key (server-only) + HMAC validation
    const headerKey = (req.get('x-api-key') || '').trim();
    const bearerKey = (req.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
    const apiKey = headerKey || bearerKey;
    if (!validateServerApiKey(apiKey)) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    const h = verifyHmac(req);
    if (!h.ok) {
      return res.status(401).json({ ok: false, error: `HMAC: ${h.error}` });
    }

    // Rate limiting
    const rl = rateLimiter.isAllowed(req.ip || 'global');
    res.setHeader('X-RateLimit-Limit', String(RATE_MAX));
    res.setHeader('X-RateLimit-Remaining', String(rl.remaining));
    if (!rl.allowed) {
      res.setHeader('Retry-After', String(rl.retryAfter));
      return res.status(429).json({ ok: false, error: 'Too many requests' });
    }

    // Request dedup
    const requestId = (req.get('x-request-id') || req.body?.requestId || '').toString();
    if (requestId) {
      const existing = dedupCache.get(requestId);
      if (existing) {
        if (existing.status === 'done') return res.status(200).json(existing.result);
        return res.status(409).json({ ok: false, error: 'Duplicate request in progress' });
      }
      dedupCache.set(requestId, { status: 'processing', ts: Date.now() });
    }

    // Validate config
    if (!walletClient || !account) {
      throw new Error('Backend wallet not configured');
    }
    if (!isAddress(LEADERBOARD_ADDRESS)) {
      throw new Error('Invalid leaderboard address');
    }

    // Body validation
    const { player, playerAddress, scoreAmount, score, scoreDelta, transactionAmount, txAmount, transactions } = req.body || {};
    const playerAddr: string = player || playerAddress;
    if (!isAddress(playerAddr)) {
      throw new Error('Invalid player address');
    }
    const scoreAmt = parseAmount(scoreAmount ?? score ?? scoreDelta, 'scoreAmount');
    const txAmt = parseAmount(transactionAmount ?? txAmount ?? transactions, 'transactionAmount');

    // Contract write: serialize to avoid nonce collisions under concurrency
    const { txHash, receipt } = await txQueue.enqueue(async () => {
      const txHash = await walletClient.writeContract({
        address: LEADERBOARD_ADDRESS,
        abi: LEADERBOARD_ABI,
        functionName: 'updatePlayerData',
        args: [playerAddr as `0x${string}`, scoreAmt, txAmt],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash as Hash });
      return { txHash, receipt } as const;
    });

    const payload = {
      ok: true,
      txHash,
      receipt: {
        transactionHash: receipt.transactionHash,
        blockNumber: receipt.blockNumber?.toString?.() ?? String(receipt.blockNumber),
        status: receipt.status,
      },
    };

    if (requestId) dedupCache.set(requestId, { status: 'done', ts: Date.now(), result: payload });
    return res.status(200).json(payload);
  } catch (err: any) {
    const msg = (err as BaseError)?.shortMessage || err?.message || String(err);
    const l = msg.toLowerCase();
    let code = 500;
    if (l.includes('insufficient') && l.includes('fund')) code = 402;
    else if (l.includes('unauthorized') || l.includes('accesscontrol')) code = 403;
    else if (l.includes('invalid') || l.includes('missing')) code = 400;
    // Store error in dedup cache to avoid stuck 'processing'
    const rid = (req.get('x-request-id') || req.body?.requestId || '').toString();
    if (rid) dedupCache.set(rid, { status: 'done', ts: Date.now(), error: { code, message: msg } });
    return res.status(code).json({ ok: false, error: msg });
  }
});

// Debug: info and optional simulate updatePlayerData against leaderboard using GAME_ADDRESS as sender
app.get('/api/debug/leaderboard', async (req, res) => {
  try {
    const headerKey = (req.get('x-api-key') || '').trim();
    const bearerKey = (req.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
    const apiKey = headerKey || bearerKey;
    if (!validateServerApiKey(apiKey)) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }

    const out: any = { ok: true, leaderboard: LEADERBOARD_ADDRESS, game: GAME_ADDRESS };

    // Optional simulation if player is provided
    const player = String(req.query.player || '').trim();
    if (isAddress(player) && isAddress(LEADERBOARD_ADDRESS) && isAddress(GAME_ADDRESS)) {
      try {
        await publicClient.simulateContract({
          address: LEADERBOARD_ADDRESS,
          abi: LEADERBOARD_ABI as any,
          functionName: 'updatePlayerData',
          args: [player as `0x${string}`, 1n, 1n],
          account: GAME_ADDRESS as `0x${string}`,
        });
        out.simulation = { ok: true };
      } catch (e: any) {
        const msg = (e as BaseError)?.shortMessage || e?.message || String(e);
        out.simulation = { ok: false, error: msg };
      }
    }

    return res.status(200).json(out);
  } catch (err: any) {
    const msg = (err as BaseError)?.shortMessage || err?.message || String(err);
    return res.status(500).json({ ok: false, error: msg });
  }
});

// Debug: decode PlayerDataUpdated events from the leaderboard for a given tx
app.get('/api/debug/tx/:hash/leaderboard-events', async (req, res) => {
  try {
    const headerKey = (req.get('x-api-key') || '').trim();
    const bearerKey = (req.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
    const apiKey = headerKey || bearerKey;
    if (!validateServerApiKey(apiKey)) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }

    const hashParam = String(req.params.hash || '').trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(hashParam)) {
      return res.status(400).json({ ok: false, error: 'Invalid tx hash' });
    }

    const receipt = await publicClient.getTransactionReceipt({ hash: hashParam as Hash });
    const events: any[] = [];
    for (const log of receipt.logs || []) {
      const addr = (log as any).address || '';
      if (String(addr).toLowerCase() !== LEADERBOARD_ADDRESS.toLowerCase()) continue;
      try {
        const decoded: any = decodeEventLog({
          abi: LEADERBOARD_ABI as any,
          data: (log as any).data,
          topics: (log as any).topics,
          strict: false
        }) as any;
        if (decoded && decoded.eventName === 'PlayerDataUpdated') {
          const args: any = decoded.args || {};
          events.push({
            address: addr,
            logIndex: (log as any).logIndex,
            blockNumber: (receipt.blockNumber as any)?.toString?.() ?? String(receipt.blockNumber),
            transactionHash: receipt.transactionHash,
            game: String(args.game || ''),
            player: String(args.player || ''),
            scoreAmount: (args.scoreAmount as any)?.toString?.() ?? String(args.scoreAmount || '0'),
            transactionAmount: (args.transactionAmount as any)?.toString?.() ?? String(args.transactionAmount || '0')
          });
        }
      } catch (_e) {
        // ignore non-decodable logs
      }
    }
    return res.status(200).json({ ok: true, leaderboard: LEADERBOARD_ADDRESS, count: events.length, events });
  } catch (err: any) {
    const msg = (err as BaseError)?.shortMessage || err?.message || String(err);
    return res.status(500).json({ ok: false, error: msg });
  }
});

// In-memory cache for leaderboard aggregation
type LeaderboardCache = { ts: number; payload: any };
let leaderboardCache: LeaderboardCache | null = null;
const searchCache = new Map<string, { ts: number; payload: any }>();

// Global (universal) leaderboard caches
let globalLeaderboardCache: LeaderboardCache | null = null;
const searchGlobalCache = new Map<string, { ts: number; payload: any }>();

// Read-only API to fetch aggregated leaderboard for this game from official contract
app.get('/api/leaderboard', async (req, res) => {
  try {
    // Origin validation (only allow configured origins for browser requests)
    const origin = req.get('origin') || '';
    if (!validateOrigin(origin)) {
      return res.status(403).json({ ok: false, error: 'Invalid origin' });
    }

    // Lightweight rate limiting to avoid abuse
    const rl = rateLimiter.isAllowed(req.ip || 'global');
    res.setHeader('X-RateLimit-Limit', String(RATE_MAX));
    res.setHeader('X-RateLimit-Remaining', String(rl.remaining));
    if (!rl.allowed) {
      res.setHeader('Retry-After', String(rl.retryAfter));
      return res.status(429).json({ ok: false, error: 'Too many requests' });
    }

    // Serve from cache unless forced
    const force = String(req.query.force || '').toLowerCase() === '1';
    if (!force && leaderboardCache && (Date.now() - leaderboardCache.ts) < LEADERBOARD_CACHE_TTL_MS) {
      return res.status(200).json(leaderboardCache.payload);
    }

    const limitParam = Number(req.query.limit || 50);
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(1, Math.trunc(limitParam)), 200) : 50;

    // Addresses to read: union of persisted knownPlayers and any keys present in localTotals
    const unionSet = new Set<string>([...Object.keys(localTotals), ...Array.from(knownPlayers)]);
    const players = Array.from(unionSet).filter((a) => isAddress(a));

    // Helper for limited concurrency mapping
    async function mapConcurrent<T, R>(arr: T[], concurrency: number, fn: (t: T, idx: number) => Promise<R>): Promise<R[]> {
      const results: R[] = new Array(arr.length);
      let next = 0;
      const worker = async () => {
        while (true) {
          const i = next++;
          if (i >= arr.length) break;
          results[i] = await fn(arr[i], i);
        }
      };
      const workers = Array(Math.min(concurrency, arr.length)).fill(0).map(() => worker());
      await Promise.all(workers);
      return results;
    }

    // Parallel on-chain reads per player (no block usage)
    const reads = await mapConcurrent(players, LEADERBOARD_READ_CONCURRENCY, async (player) => {
      try {
        const result = await publicClient.readContract({
          address: LEADERBOARD_ADDRESS,
          abi: LEADERBOARD_ABI,
          functionName: 'playerDataPerGame',
          args: [GAME_ADDRESS, player as `0x${string}`]
        }) as readonly [bigint, bigint];
        const [score, transactions] = result || [0n, 0n];
        return { player, score, transactions };
      } catch {
        return { player, score: 0n, transactions: 0n };
      }
    });

    const items = reads
      .map(r => ({ player: r.player, score: r.score.toString(), transactions: r.transactions.toString() }))
      .sort((a, b) => {
        const ds = BigInt(b.score) - BigInt(a.score);
        if (ds !== 0n) return ds > 0n ? 1 : -1;
        const dt = BigInt(b.transactions) - BigInt(a.transactions);
        return dt > 0n ? 1 : dt < 0n ? -1 : 0;
      })
      .slice(0, limit);

    const payload = {
      ok: true,
      game: GAME_ADDRESS,
      leaderboardContract: LEADERBOARD_ADDRESS,
      totalPlayers: players.length,
      count: items.length,
      items,
      updatedAt: new Date().toISOString()
    };

    leaderboardCache = { ts: Date.now(), payload };
    // Persist latest items into snapshot for restart resilience
    await saveSnapshot({ lastItems: items as LeaderboardItem[], lastItemsUpdatedAt: payload.updatedAt });
    return res.status(200).json(payload);
  } catch (err: any) {
    const msg = (err as BaseError)?.shortMessage || err?.message || String(err);
    return res.status(500).json({ ok: false, error: msg });
  }
});

// Read-only API to fetch universal (global) totals for known players from official contract
app.get('/api/leaderboard/global', async (req, res) => {
  try {
    // Origin validation (only allow configured origins for browser requests)
    const origin = req.get('origin') || '';
    if (!validateOrigin(origin)) {
      return res.status(403).json({ ok: false, error: 'Invalid origin' });
    }

    // Lightweight rate limiting
    const rl = rateLimiter.isAllowed(req.ip || 'global');
    res.setHeader('X-RateLimit-Limit', String(RATE_MAX));
    res.setHeader('X-RateLimit-Remaining', String(rl.remaining));
    if (!rl.allowed) {
      res.setHeader('Retry-After', String(rl.retryAfter));
      return res.status(429).json({ ok: false, error: 'Too many requests' });
    }

    // Serve from cache unless forced
    const force = String(req.query.force || '').toLowerCase() === '1';
    if (!force && globalLeaderboardCache && (Date.now() - globalLeaderboardCache.ts) < LEADERBOARD_CACHE_TTL_MS) {
      return res.status(200).json(globalLeaderboardCache.payload);
    }

    const limitParam = Number(req.query.limit || 50);
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(1, Math.trunc(limitParam)), 200) : 50;

    // Addresses to read: union of persisted knownPlayers and localTotals
    const unionSet = new Set<string>([...Object.keys(localTotals), ...Array.from(knownPlayers)]);
    const players = Array.from(unionSet).filter((a) => isAddress(a));

    // Helper for limited concurrency mapping
    async function mapConcurrent<T, R>(arr: T[], concurrency: number, fn: (t: T, idx: number) => Promise<R>): Promise<R[]> {
      const results: R[] = new Array(arr.length);
      let next = 0;
      const worker = async () => {
        while (true) {
          const i = next++;
          if (i >= arr.length) break;
          results[i] = await fn(arr[i], i);
        }
      };
      const workers = Array(Math.min(concurrency, arr.length)).fill(0).map(() => worker());
      await Promise.all(workers);
      return results;
    }

    // Parallel on-chain reads per player: global totals
    const reads = await mapConcurrent(players, LEADERBOARD_READ_CONCURRENCY, async (player) => {
      try {
        const [score, transactions] = await Promise.all([
          publicClient.readContract({ address: LEADERBOARD_ADDRESS, abi: LEADERBOARD_ABI, functionName: 'totalScoreOfPlayer', args: [player as `0x${string}`] }) as Promise<bigint>,
          publicClient.readContract({ address: LEADERBOARD_ADDRESS, abi: LEADERBOARD_ABI, functionName: 'totalTransactionsOfPlayer', args: [player as `0x${string}`] }) as Promise<bigint>,
        ]);
        return { player, score: (score ?? 0n).toString(), transactions: (transactions ?? 0n).toString() };
      } catch {
        return { player, score: '0', transactions: '0' };
      }
    });

    const items = reads
      .map(r => ({ player: r.player, score: r.score, transactions: r.transactions }))
      .sort((a, b) => {
        const ds = BigInt(b.score) - BigInt(a.score);
        if (ds !== 0n) return ds > 0n ? 1 : -1;
        const dt = BigInt(b.transactions) - BigInt(a.transactions);
        return dt > 0n ? 1 : dt < 0n ? -1 : 0;
      })
      .slice(0, limit);

    const payload = {
      ok: true,
      scope: 'global',
      leaderboardContract: LEADERBOARD_ADDRESS,
      totalPlayers: players.length,
      count: items.length,
      items,
      updatedAt: new Date().toISOString()
    };

    globalLeaderboardCache = { ts: Date.now(), payload };
    return res.status(200).json(payload);
  } catch (err: any) {
    const msg = (err as BaseError)?.shortMessage || err?.message || String(err);
    return res.status(500).json({ ok: false, error: msg });
  }
});

// Recent hands (in-memory) for UI Recent tab
app.get('/api/leaderboard/recent', async (req, res) => {
  try {
    const origin = req.get('origin') || '';
    if (!validateOrigin(origin)) {
      return res.status(403).json({ ok: false, error: 'Invalid origin' });
    }

    const rl = rateLimiter.isAllowed(req.ip || 'global');
    res.setHeader('X-RateLimit-Limit', String(RATE_MAX));
    res.setHeader('X-RateLimit-Remaining', String(rl.remaining));
    if (!rl.allowed) {
      res.setHeader('Retry-After', String(rl.retryAfter));
      return res.status(429).json({ ok: false, error: 'Too many requests' });
    }

    const limitParam = Number(req.query.limit || 50);
    const limit = Number.isFinite(limitParam)
      ? Math.min(Math.max(1, Math.trunc(limitParam)), RECENT_HANDS_SIZE)
      : Math.min(50, RECENT_HANDS_SIZE);

    // Ensure timestamp is in milliseconds for the frontend
    const items = recentHands
      .slice(-limit)
      .reverse()
      .map((h) => ({
        ...h,
        timestamp: (typeof h.timestamp === 'number' && h.timestamp < 1_000_000_000_000) ? h.timestamp * 1000 : h.timestamp,
      }));

    return res.status(200).json({ ok: true, count: items.length, items });
  } catch (err: any) {
    const msg = (err as BaseError)?.shortMessage || err?.message || String(err);
    return res.status(500).json({ ok: false, error: msg });
  }
});

app.get('/api/leaderboard/status', async (req, res) => {
  try {
    const headerKey = (req.get('x-api-key') || '').trim();
    const bearerKey = (req.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
    const apiKey = headerKey || bearerKey;
    if (!validateServerApiKey(apiKey)) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    return res.status(200).json({
      ok: true,
      game: GAME_ADDRESS,
      leaderboardContract: LEADERBOARD_ADDRESS,
      snapshotPath: LEADERBOARD_SNAPSHOT_PATH,
      knownPlayers: Array.from(knownPlayers),
      knownPlayersCount: knownPlayers.size,
      recentHandsCount: recentHands.length,
      recentHandsSize: RECENT_HANDS_SIZE,
      indexingEnabled: LEADERBOARD_INDEXER_ENABLED
    });
  } catch (err: any) {
    const msg = (err as BaseError)?.shortMessage || err?.message || String(err);
    return res.status(500).json({ ok: false, error: msg });
  }
});

// Global scope: on-demand single-address lookup of universal totals
app.get('/api/leaderboard/search-global', async (req, res) => {
  try {
    const origin = req.get('origin') || '';
    if (!validateOrigin(origin)) {
      return res.status(403).json({ ok: false, error: 'Invalid origin' });
    }

    const rl = rateLimiter.isAllowed(req.ip || 'global');
    res.setHeader('X-RateLimit-Limit', String(RATE_MAX));
    res.setHeader('X-RateLimit-Remaining', String(rl.remaining));
    if (!rl.allowed) {
      res.setHeader('Retry-After', String(rl.retryAfter));
      return res.status(429).json({ ok: false, error: 'Too many requests' });
    }

    const addr = String(req.query.address || '').trim();
    if (!isAddress(addr)) return res.status(400).json({ ok: false, error: 'Invalid address' });

    const key = addr.toLowerCase();
    const cached = searchGlobalCache.get(key);
    if (cached && (Date.now() - cached.ts) < SEARCH_CACHE_TTL_MS) {
      return res.status(200).json(cached.payload);
    }

    const [score, transactions] = await Promise.all([
      publicClient.readContract({ address: LEADERBOARD_ADDRESS, abi: LEADERBOARD_ABI, functionName: 'totalScoreOfPlayer', args: [addr as `0x${string}`] }) as Promise<bigint>,
      publicClient.readContract({ address: LEADERBOARD_ADDRESS, abi: LEADERBOARD_ABI, functionName: 'totalTransactionsOfPlayer', args: [addr as `0x${string}`] }) as Promise<bigint>,
    ]);

    const payload = {
      ok: true,
      address: addr,
      score: (score ?? 0n).toString(),
      transactions: (transactions ?? 0n).toString(),
    };
    searchGlobalCache.set(key, { ts: Date.now(), payload });
    return res.status(200).json(payload);
  } catch (err: any) {
    const msg = (err as BaseError)?.shortMessage || err?.message || String(err);
    return res.status(500).json({ ok: false, error: msg });
  }
});

// ... (rest of the code remains the same)

// Public: on-demand single-address lookup from on-chain leaderboard (no persistence)
app.get('/api/leaderboard/search', async (req, res) => {
  try {
    const origin = req.get('origin') || '';
    if (!validateOrigin(origin)) {
      return res.status(403).json({ ok: false, error: 'Invalid origin' });
    }

    const rl = rateLimiter.isAllowed(req.ip || 'global');
    res.setHeader('X-RateLimit-Limit', String(RATE_MAX));
    res.setHeader('X-RateLimit-Remaining', String(rl.remaining));
    if (!rl.allowed) {
      res.setHeader('Retry-After', String(rl.retryAfter));
      return res.status(429).json({ ok: false, error: 'Too many requests' });
    }

    const addr = String(req.query.address || '').trim();
    if (!isAddress(addr)) return res.status(400).json({ ok: false, error: 'Invalid address' });

    const key = addr.toLowerCase();
    const cached = searchCache.get(key);
    if (cached && (Date.now() - cached.ts) < SEARCH_CACHE_TTL_MS) {
      return res.status(200).json(cached.payload);
    }

    // Single on-chain read (no blocks, no logs)
    const result = await publicClient.readContract({
      address: LEADERBOARD_ADDRESS,
      abi: LEADERBOARD_ABI,
      functionName: 'playerDataPerGame',
      args: [GAME_ADDRESS, addr as `0x${string}`]
    }) as readonly [bigint, bigint];
    const [score, transactions] = result || [0n, 0n];
    const payload = { ok: true, address: addr, score: score.toString(), transactions: transactions.toString() };
    searchCache.set(key, { ts: Date.now(), payload });
    return res.status(200).json(payload);
  } catch (err: any) {
    const msg = (err as BaseError)?.shortMessage || err?.message || String(err);
    return res.status(500).json({ ok: false, error: msg });
  }
});

// Basic environment validation at startup
function ensureConfig() {
  const missing: string[] = [];

  if (!LEADERBOARD_ADDRESS || !isAddress(LEADERBOARD_ADDRESS)) missing.push('LEADERBOARD_CONTRACT_ADDRESS');

  // Enforce secrets only when write endpoints are enabled
  if (ENABLE_UPDATE_ENDPOINT) {
    if (!API_SECRET) missing.push('API_SECRET (required when ENABLE_UPDATE_ENDPOINT=true)');
    if (!HMAC_SECRET) missing.push('HMAC_SECRET (required when ENABLE_UPDATE_ENDPOINT=true)');
    if (!PRIVATE_KEY) missing.push('WALLET_PRIVATE_KEY (required when ENABLE_UPDATE_ENDPOINT=true)');
  }
  if (ENABLE_BATCH_ENDPOINT) {
    if (!API_SECRET) missing.push('API_SECRET (required when ENABLE_BATCH_ENDPOINT=true)');
    if (!HMAC_SECRET) missing.push('HMAC_SECRET (required when ENABLE_BATCH_ENDPOINT=true)');
    if (!PRIVATE_KEY) missing.push('WALLET_PRIVATE_KEY (required when ENABLE_BATCH_ENDPOINT=true)');
    if (!GAME_CONTRACT_ADDRESS || !isAddress(GAME_CONTRACT_ADDRESS)) missing.push('GAME_CONTRACT_ADDRESS (required when ENABLE_BATCH_ENDPOINT=true)');
  }

  if (missing.length) {
    console.error('Missing required env vars:', missing.join(', '));
    process.exit(1);
  }

  if (ALLOWED_ORIGINS.length === 0) {
    console.warn('Warning: ALLOWED_ORIGINS is empty. Set NEXT_PUBLIC_APP_URL or APP_URL to allow browser-origin requests.');
  }
}
ensureConfig();

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Backend ready. Endpoints: POST /api/update-player-data, POST /api/submit-hand-batch, GET /api/leaderboard, GET /api/leaderboard/global, GET /api/leaderboard/status, GET /api/leaderboard/recent, GET /api/leaderboard/search, GET /api/leaderboard/search-global' });
});

app.listen(port, () => {
  console.log(`Secure server running on port ${port}`);
});
