export type SubmitPlayerDataParams = {
  playerAddress: string;
  scoreAmount: number | string | bigint;
  transactionAmount: number | string | bigint;
  requestId?: string;
};

export type SubmitPlayerDataResponse =
  | { ok: true; txHash: string; receipt: any }
  | { ok: false; error: string };

function getBaseUrl() {
  const envs = (import.meta as any)?.env || {};
  const explicit = (envs?.VITE_BACKEND_URL as string | undefined)?.trim();
  const isDev = !!envs?.DEV;
  // Normalize to no trailing slash
  const norm = (v: string | undefined) => (v ? (v.endsWith('/') ? v.slice(0, -1) : v) : '');
  if (explicit) return norm(explicit);
  // Runtime inference: if the app is mounted under a subpath like '/poker',
  // prefer that as the backend base to avoid dropping the prefix in production proxies.
  try {
    const p = (typeof window !== 'undefined' && window.location ? window.location.pathname : '') || '';
    if (p === '/poker' || p.startsWith('/poker/')) return '/poker';
  } catch {}
  // In dev, rely on Vite proxy at '/api' (base should be empty)
  if (isDev) return '';
  // In production, fall back to the app's base path (e.g. '/poker')
  const baseUrl = (envs?.BASE_URL as string | undefined) || '';
  return norm(baseUrl);
}

// Exported so non-score modules (e.g., leaderboard UI) can share identical base resolution
export function getBackendBase(): string {
  return getBaseUrl();
}

function getClientApiKey(): string | undefined {
  const key = (import.meta as any)?.env?.VITE_CLIENT_API_SECRET as string | undefined;
  return (key || '').trim() || undefined;
}

function toId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return (crypto.randomUUID() as string);
  }
  return `req_${Math.random().toString(36).slice(2)}_${Date.now()}`;
}

export type SubmitHandBatchParams = {
  players: string[];
  winners: boolean[];
  roomId: string;
  handSeq: string;
  handId?: string;
  tableId?: string;
  deckHash?: string;
  requestId?: string;
};

export async function submitHandBatch(params: SubmitHandBatchParams): Promise<SubmitPlayerDataResponse> {
  const { players, winners, roomId, handSeq, handId, tableId, deckHash } = params;

  if (!Array.isArray(players) || players.length === 0) {
    return { ok: false, error: 'Missing players' };
  }
  if (!Array.isArray(winners) || winners.length !== players.length) {
    return { ok: false, error: 'players/winners length mismatch' };
  }

  const rid = params.requestId || toId();
  const base = getBaseUrl();
  const url = `${base}/api/client/submit-hand-batch`;
  const clientKey = getClientApiKey();

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-request-id': rid,
        ...(clientKey ? { 'x-api-key': clientKey } : {}),
      },
      body: JSON.stringify({
        players,
        winners,
        roomId,
        handSeq,
        handId,
        tableId,
        deckHash,
        requestId: rid,
      }),
    } as any);

    const text = await res.text();
    let data: any;
    try { data = JSON.parse(text); } catch { data = { ok: false, error: text || 'Invalid response' }; }
    if (!res.ok) {
      const msg = (data && typeof data.error === 'string') ? data.error : `HTTP ${res.status}`;
      // Treat duplicate/in-flight conflicts as non-fatal
      if (res.status === 409 && /duplicate/i.test(msg)) {
        return { ok: true, txHash: '', receipt: null } as any;
      }
      return { ok: false, error: msg };
    }
    return data as SubmitPlayerDataResponse;
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

export async function submitPlayerData(params: SubmitPlayerDataParams): Promise<SubmitPlayerDataResponse> {
  const { playerAddress } = params;
  const scoreAmount = params.scoreAmount as any;
  const transactionAmount = params.transactionAmount as any;

  if (!playerAddress || typeof playerAddress !== 'string') {
    return { ok: false, error: 'Missing player address' };
  }

  const rid = params.requestId || toId();
  const base = getBaseUrl();
  const url = `${base}/api/client/update-player-data`;
  const clientKey = getClientApiKey();

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-request-id': rid,
        ...(clientKey ? { 'x-api-key': clientKey } : {}),
      },
      body: JSON.stringify({
        playerAddress,
        scoreAmount: typeof scoreAmount === 'bigint' ? scoreAmount.toString() : String(scoreAmount),
        transactionAmount: typeof transactionAmount === 'bigint' ? transactionAmount.toString() : String(transactionAmount),
        requestId: rid,
      }),
    });

    const text = await res.text();
    let data: any;
    try { data = JSON.parse(text); } catch { data = { ok: false, error: text || 'Invalid response' }; }
    if (!res.ok) {
      const msg = (data && typeof data.error === 'string') ? data.error : `HTTP ${res.status}`;
      // Treat duplicate/in-flight conflicts as non-fatal to avoid noisy errors when
      // effects fire twice in dev or when two leader hosts briefly overlap.
      if (res.status === 409 && /duplicate/i.test(msg)) {
        return { ok: true, txHash: '', receipt: null } as any;
      }
      return { ok: false, error: msg };
    }
    return data as SubmitPlayerDataResponse;
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}
