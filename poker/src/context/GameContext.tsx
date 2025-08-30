import React, { useEffect, useState, createContext, useContext } from 'react';
import { PokerEngine } from '../engine';
import { submitHandBatch } from '../lib/scoreApi';
import { Player } from '../types';
import { GameState, PlayerAction, GameStage } from '../types';
import { useStateTogether } from 'react-together';
import { usePrivy, useWallets, CrossAppAccountWithMetadata, type ConnectedWallet } from '@privy-io/react-auth';
import { keccak256, createWalletClient, custom, type Hex, type Address } from 'viem';

type GameSettings = {
  startingChips: number;
  smallBlind: number;
  bigBlind: number;
  turnTimeSeconds: number;
};

// TableSettings extends GameSettings with metadata about creator
type TableSettings = GameSettings & {
  creatorId: string;
  createdAt: number;
};

type GameContextType = {
  engine: PokerEngine | null;
  gameState: GameState | null;
  startGame: (playerNames: string[], settings?: GameSettings) => Promise<void>;
  performAction: (action: PlayerAction, amount?: number) => void;
  nextHand: () => void;
  createTable: (nick: string, stack: number, sb: number, bb: number) => void;
  joinTable: (nick: string) => void;
  showdownData: { winners: Player[]; evaluations: Record<number, any> } | null;
  currentPlayerIndex: number | null;
  isDealing: boolean;
  lastTxHash: string | null;
  gameSettings: GameSettings | null;
  isHost: boolean;
  tableSettings: TableSettings | null;
  gameStarted: boolean;
  isGameStarted: boolean; // alias used by UI components
  players: string[];
  beginGame: () => void;
  manualReshuffle: () => void;
  turnDeadline: number | null;
};

// Helper imports for embedded wallet contract interaction
import { 
  fetchShuffleFee, 
  encodeRequestShuffleData, 
  DEALER_ADDRESS, 
  waitForDeck,
  parseSequenceFromReceipt,
  getPublicClient,
  monadTestnet,
} from '../entropyDealer';

type ShuffleResponse = { packedDeck: string; txHash?: string; sequence: bigint; deckHash: Hex };

// Normalize transaction errors to user-friendly codes/messages
function normalizeTxError(err: any): { code: 'INSUFFICIENT_FUNDS' | 'USER_REJECTED' | 'TX_ERROR'; message: string } {
  const msg = String(err?.message || err?.cause?.message || '');
  const short = String(err?.shortMessage || err?.cause?.shortMessage || '');
  const name = String(err?.name || '');
  const causeName = String(err?.cause?.name || '');
  const code = (err?.code ?? err?.cause?.code) as number | string | undefined;

  const insufficient =
    name === 'InsufficientFundsError' ||
    causeName === 'InsufficientFundsError' ||
    /insufficient funds/i.test(msg) ||
    /insufficient funds/i.test(short) ||
    /insufficient balance/i.test(msg) ||
    /insufficient balance/i.test(short) ||
    /gas\s*\*\s*price\s*\+\s*value/i.test(msg) ||
    /gas\s*\*\s*price\s*\+\s*value/i.test(short) ||
    code === -32000 || // common JSON-RPC code for insufficient funds
    code === 'INSUFFICIENT_FUNDS';
  if (insufficient) {
    return {
      code: 'INSUFFICIENT_FUNDS',
      message: 'Insufficient balance to cover shuffle fee and gas. Please fund your wallet and retry.'
    };
  }
  if (code === 4001 || /User rejected|rejected the request/i.test(msg) || /rejected/i.test(short)) {
    return { code: 'USER_REJECTED', message: 'Transaction was rejected. You can retry when ready.' };
  }
  return { code: 'TX_ERROR', message: 'Transaction failed. Please try again.' };
}

// Send shuffle using the Privy embedded wallet (in-app)
const requestShuffleWithEmbeddedWallet = async (embeddedWallet: ConnectedWallet) => {
  if (!embeddedWallet?.address) {
    throw new Error('Embedded wallet not found');
  }
  const embeddedAddress = embeddedWallet.address as Address;
  console.log('[Shuffle] Using Embedded wallet address:', embeddedAddress);

  // Get shuffle fee from contract
  const fee = await fetchShuffleFee();
  
  // Encode the contract call data
  const data = encodeRequestShuffleData();

  // Pre-check balance vs. required cost to provide instant feedback
  // Also capture gas & gasPrice to pass explicitly to wallet to avoid undefined conversions
  let gasEstimate: bigint | undefined;
  let gasPrice: bigint | undefined;
  try {
    const publicClient = getPublicClient();
    const gas = await publicClient.estimateGas({
      account: embeddedAddress as any,
      to: DEALER_ADDRESS,
      data,
      value: fee,
    });
    gasEstimate = gas;
    gasPrice = await publicClient.getGasPrice();
    const needed = gas * (gasPrice as bigint) + fee;
    const balance = await publicClient.getBalance({ address: embeddedAddress as any });
    if (balance < needed) {
      console.warn('[PreCheck] Insufficient funds. balance=', balance.toString(), 'needed=', needed.toString());
      const e: any = new Error('Insufficient balance to cover shuffle fee and gas. Please fund your wallet and retry.');
      e.code = 'INSUFFICIENT_FUNDS';
      throw e;
    }
  } catch (preErr) {
    console.warn('[PreCheck] Error during gas/balance pre-check:', preErr);
    // Normalize for side effects/logging; ignore result here
    normalizeTxError(preErr);
  }

  console.log('Sending shuffle transaction with:', { to: DEALER_ADDRESS, data, value: fee, gas: gasEstimate, gasPrice });

  // Build a viem wallet client from the embedded wallet provider
  const provider = await embeddedWallet.getEthereumProvider();
  const walletClient = createWalletClient({ chain: monadTestnet, transport: custom(provider) });

  // Send tx (viem handles bigint serialization)
  const txHash = await walletClient.sendTransaction({
    account: embeddedAddress,
    to: DEALER_ADDRESS,
    data,
    value: fee,
    // Let node estimate gas/price; we only used estimates for pre-check
  });
  if (!txHash) {
    throw new Error('No transaction hash returned from wallet');
  }

  // Wait for transaction receipt and parse sequence number
  const publicClient = getPublicClient();
  // Manually poll for receipt to avoid BigInt formatting issues inside viem wait helper
  let receipt: any | null = null;
  for (let i = 0; i < 40; i++) {
    try {
      receipt = await publicClient.getTransactionReceipt({ hash: txHash as `0x${string}` });
      break;
    } catch (_e) {
      // Receipt not ready yet
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  if (!receipt) {
    throw new Error('Transaction receipt not found within timeout');
  }
  if ((receipt as any)?.status && (receipt as any).status !== 'success') {
    throw new Error('Transaction failed or was reverted');
  }
  const sequenceNumber = parseSequenceFromReceipt(receipt);
  
  if (!sequenceNumber) {
    throw new Error('Failed to parse sequence number from transaction receipt');
  }

  // Wait for the shuffle to complete and get the packed deck
  try {
    return new Promise<ShuffleResponse>(async (resolve, reject) => {
      let unwatch: (() => void) | undefined;
      const timeout = setTimeout(() => {
        try { unwatch && unwatch(); } catch {}
        reject(new Error('Shuffle timeout - deck not received within 30 seconds'));
      }, 30000);

      console.log('Waiting for shuffle event with sequence:', sequenceNumber.toString());
      
      try {
        unwatch = await waitForDeck(sequenceNumber, (packedDeck: string) => {
          console.log('Received shuffled deck:', packedDeck);
          console.log('Deck type:', typeof packedDeck, 'length:', packedDeck.length);
          clearTimeout(timeout);
          try { unwatch && unwatch(); } catch {}
          // Compute deck hash (bytes32)
          const deckHash = keccak256(packedDeck as Hex);
          resolve({ packedDeck, txHash, sequence: sequenceNumber, deckHash });
        });
      } catch (watchErr) {
        clearTimeout(timeout);
        reject(watchErr);
      }
    });
  } catch (error) {
    console.error('Shuffle request failed:', error);
    const norm = normalizeTxError(error);
    const e: any = new Error(norm.message);
    e.code = norm.code;
    throw e;
  }
};

// Shared state types for Multisynq
type SharedGame = {
  gameState: GameState | null;
  lastTxHash: string | null;
  showdownData: {
    winners: Player[];
    evaluations: Record<number, any>;
  } | null;
  handSeq?: string; // sequence number from dealer event
  deckHash?: Hex;   // keccak256(packedDeck)
  handCounter?: number; // increment per hand to ensure unique handId
};
type LobbyState = {
  creatorId: string; // clientId of host
  started: boolean;
  settings: GameSettings | null;
};
type ActionRequest = {
  seq: number;
  byName: string;
  action: PlayerAction | null;
  amount?: number;
};

// Extra context fields for UI can be added later (e.g., loading status)
const GameContext = createContext<GameContextType>({
  engine: null,
  gameState: null,
  startGame: async () => {},
  performAction: () => {},
  nextHand: () => {},
  createTable: () => {},
  joinTable: () => {},
  showdownData: null,
  currentPlayerIndex: null,
  isDealing: false,
  lastTxHash: null,
  gameSettings: null,
  isHost: false,
  tableSettings: null,
  gameStarted: false,
  isGameStarted: false,
  players: [],
  beginGame: () => {},
  manualReshuffle: () => {},
  turnDeadline: null,
});
export const useGame = () => useContext(GameContext);
export const GameProvider: React.FC<{
  children: React.ReactNode;
}> = ({
  children
}) => {
  // Privy hooks for embedded wallet interaction
  const { user } = usePrivy();
  const { wallets } = useWallets();
  const [engine, setEngine] = useState<PokerEngine | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [showdownData, setShowdownData] = useState<{
    winners: Player[];
    evaluations: Record<number, any>;
  } | null>(null);
  const [currentPlayerIndex, setCurrentPlayerIndex] = useState<number | null>(null);
  const [isDealing, setIsDealing] = useState(false);
  const [lastTxHash, setLastTxHash] = useState<string | null>(null);
  const [gameSettings, setGameSettings] = useState<GameSettings | null>(null);
  const [dealingError, setDealingError] = useState<{ code: string; message: string } | null>(null);
  const [lastShuffleAction, setLastShuffleAction] = useState<'startGame' | 'nextHand' | 'manualReshuffle' | null>(null);

  // Multisynq nickname
  const nickname = (localStorage.getItem('playerName') || '').trim();
  // Stable client id for host identification
  const clientId = React.useMemo(() => {
    let id = localStorage.getItem('clientId');
    if (!id) {
      id = (typeof crypto !== 'undefined' && 'randomUUID' in crypto) ? (crypto.randomUUID() as string) : Math.random().toString(36).slice(2);
      localStorage.setItem('clientId', id);
    }
    return id;
  }, []);

  // Shared states
  const [tableSettings, setTableSettings] = useStateTogether<TableSettings | null>('tableSettings', null);
  const [gameStarted, setGameStarted] = useStateTogether<boolean>('gameStarted', false);
  const [players, setPlayers] = useStateTogether<string[]>('players', []);
  const [playerAddrs, setPlayerAddrs] = useStateTogether<string[]>('playerAddrs', []);
  const [lobby, setLobby] = useStateTogether<LobbyState>('lobby', { creatorId: '', started: false, settings: null });
  // Persisted shared game state per room
  const roomId = (() => {
    const p = new URLSearchParams(window.location.search);
    const qp = p.get('room') || p.get('lobbyId') || p.get('id');
    if (qp) return qp;
    const m = window.location.pathname.match(/(?:^|\/)(?:game|lobby)\/([^/]+)/);
    return m ? m[1] : 'local';
  })();
  const savedKey = `pokerSavedGame-${roomId}`;
  const savedRaw = typeof localStorage !== 'undefined' ? localStorage.getItem(savedKey) : null;
  const initialSaved: SharedGame | null = savedRaw ? JSON.parse(savedRaw) : null;
  const [sharedGame, setSharedGame] = useStateTogether<SharedGame | null>('game', initialSaved);
  const [actionReq, setActionReq] = useStateTogether<ActionRequest>('actionReq', { seq: 0, byName: '', action: null });
  const [actionProcessed, setActionProcessed] = useStateTogether<number>('actionProcessed', 0);
  // 15-second turn timer deadline (epoch ms)
  const [turnDeadline, setTurnDeadline] = useStateTogether<number | null>('turnDeadline', null);
  const isHost = tableSettings?.creatorId === clientId;
  // Track last seen current player to only reset deadline on turn changes
  const lastIndexRef = React.useRef<number | null>(null);
  // Track last seen stage to reset deadline at start of each betting round
  const lastStageRef = React.useRef<GameStage | null>(null);
  // Ensure we only submit once per hand sequence
  const submittedHandSeqs = React.useRef<Set<string>>(new Set());

  // Host leader election per room (prevents duplicate timers/auto-actions/txs across multiple host tabs)
  const [isLeader, setIsLeader] = useState(false);
  const leaderKey = `pokerHostLeader-${roomId}`;
  const LEADER_TTL_MS = 5000; // lease time
  const HEARTBEAT_MS = 2000; // renew interval

  useEffect(() => {
    if (!isHost) {
      setIsLeader(false);
      return;
    }
    const claimOrRefresh = () => {
      const now = Date.now();
      let data: any = null;
      try { const raw = localStorage.getItem(leaderKey); data = raw ? JSON.parse(raw) : null; } catch {}
      if (!data || typeof data !== 'object' || !data.clientId || typeof data.expiresAt !== 'number' || data.expiresAt < now) {
        // Acquire or reacquire
        try { localStorage.setItem(leaderKey, JSON.stringify({ clientId, expiresAt: now + LEADER_TTL_MS })); } catch {}
        setIsLeader(true);
      } else {
        setIsLeader(data.clientId === clientId);
      }
    };
    claimOrRefresh();
    const hb = setInterval(() => {
      if (!isLeader) { claimOrRefresh(); return; }
      const now = Date.now();
      try { localStorage.setItem(leaderKey, JSON.stringify({ clientId, expiresAt: now + LEADER_TTL_MS })); } catch {}
    }, HEARTBEAT_MS);
    const onVisOrFocus = () => claimOrRefresh();
    window.addEventListener('visibilitychange', onVisOrFocus);
    window.addEventListener('focus', onVisOrFocus);
    const onUnload = () => {
      try {
        const raw = localStorage.getItem(leaderKey);
        if (raw) {
          const data = JSON.parse(raw);
          if (data?.clientId === clientId) localStorage.removeItem(leaderKey);
        }
      } catch {}
    };
    window.addEventListener('beforeunload', onUnload);
    return () => {
      clearInterval(hb);
      window.removeEventListener('visibilitychange', onVisOrFocus);
      window.removeEventListener('focus', onVisOrFocus);
      window.removeEventListener('beforeunload', onUnload);
    };
  }, [isHost, clientId, leaderKey, isLeader]);

  // Update game state whenever engine changes
  useEffect(() => {
    if (engine && isHost && gameStarted) {
      setGameState(engine.getState());
      setCurrentPlayerIndex(engine.getCurrentPlayerIndex());
    }
  }, [engine, isHost, gameStarted]);

  // Mirror shared game state to local derived state (all clients)
  useEffect(() => {
    if (sharedGame) {
      setGameState(sharedGame.gameState);
      setShowdownData(sharedGame.showdownData);
      setLastTxHash(sharedGame.lastTxHash);
    }
    // Consider game started if lobby flag OR shared game state exists
    const started = gameStarted || (sharedGame?.gameState != null);
    const nextIdx = sharedGame?.gameState?.currentPlayerIndex ?? null;
    const stage = sharedGame?.gameState?.stage;
    const secs = gameSettings?.turnTimeSeconds ?? 15;

    // Sync settings and current player locally
    setGameSettings(lobby.settings);
    setCurrentPlayerIndex(nextIdx);

    // Pause/clear deadline when not started or during showdown
    if (!started || stage === GameStage.Showdown) {
      if (turnDeadline !== null) setTurnDeadline(null);
      // Safe to update refs in these states
      lastIndexRef.current = nextIdx;
      lastStageRef.current = stage ?? null;
      return;
    }

    // While dealing, pause the timer but DO NOT update last refs.
    // This ensures a stageChanged is detected right after dealing ends (e.g., at start of Pre-Flop).
    if (isDealing) {
      if (turnDeadline !== null) setTurnDeadline(null);
      return;
    }

    // Only host resets deadline on actual turn change OR on stage change (start of new street)
    const turnChanged = nextIdx != null && nextIdx !== lastIndexRef.current;
    const stageChanged = !!stage && stage !== lastStageRef.current;
    const isLeaderHost = isHost && isLeader;
    if (isLeaderHost && (turnChanged || stageChanged)) {
      setTurnDeadline(Date.now() + secs * 1000);
    }
    lastIndexRef.current = nextIdx;
    lastStageRef.current = stage ?? null;
  }, [sharedGame, lobby, isHost, isDealing, gameStarted, gameSettings, turnDeadline]);



  // Host starts the game after at least 2 players
  const beginGame = async () => {
    if (!isHost || !isLeader || gameStarted || !tableSettings) return;
    await startGame(players, tableSettings);
    setGameStarted(true);
  };
  // Helper create/join functions for new lobby-less flow
  const createTable = (nick: string, stack: number, sb: number, bb: number) => {
    localStorage.setItem('playerName', nick);
    sessionStorage.setItem('mySeatName', nick);
    const newSettings: TableSettings = { startingChips: stack, smallBlind: sb, bigBlind: bb, turnTimeSeconds: 30, creatorId: clientId, createdAt: Date.now() };
    
    // Reset all shared states for new table
    setTableSettings(newSettings);
    setPlayers([nick]);
    try {
      // Get Monad Games ID embedded wallet address
      let addr = '';
      if (user?.linkedAccounts && user.linkedAccounts.length > 0) {
        const crossAppAccount: CrossAppAccountWithMetadata | undefined = user.linkedAccounts
          .filter((account: any) => account.type === 'cross_app' && account.providerApp?.id === 'cmd8euall0037le0my79qpz42')[0] as CrossAppAccountWithMetadata | undefined;
        if (crossAppAccount && crossAppAccount.embeddedWallets.length > 0) {
          addr = crossAppAccount.embeddedWallets[0].address;
        }
      }
      setPlayerAddrs([addr]);
    } catch { setPlayerAddrs(['']); }
    setGameStarted(false);
    setLobby({ creatorId: clientId, started: false, settings: newSettings });
    setSharedGame(null);
    setActionReq({ seq: 0, byName: '', action: null });
    setActionProcessed(0);
    setTurnDeadline(null);
    
    // Reset local states
    setEngine(null);
    setGameState(null);
    setShowdownData(null);
    setCurrentPlayerIndex(null);
    setIsDealing(false);
    setLastTxHash(null);
    setGameSettings(newSettings);
    
    sessionStorage.setItem('mySeatIndex', '0');
  };
  const joinTable = (nick: string) => {
    localStorage.setItem('playerName', nick);
    sessionStorage.setItem('mySeatName', nick);
    setPlayers(prev => {
      if (prev.includes(nick)) return prev;
      // find first empty seat (max 10)
      const taken = new Set(prev);
      let seatIdx = 0;
      while (seatIdx < 10 && taken.has(prev[seatIdx])) seatIdx++;
      const next = [...prev];
      while (next.length <= seatIdx) next.push('');
      next[seatIdx] = nick;
      sessionStorage.setItem('mySeatIndex', seatIdx.toString());
      return next;
    });
    // Record the joiner's address at the same seat index
    try {
      // Get Monad Games ID embedded wallet address
      let addr = '';
      if (user?.linkedAccounts && user.linkedAccounts.length > 0) {
        const crossAppAccount: CrossAppAccountWithMetadata | undefined = user.linkedAccounts
          .filter((account: any) => account.type === 'cross_app' && account.providerApp?.id === 'cmd8euall0037le0my79qpz42')[0] as CrossAppAccountWithMetadata | undefined;
        if (crossAppAccount && crossAppAccount.embeddedWallets.length > 0) {
          addr = crossAppAccount.embeddedWallets[0].address;
        }
      }
      setPlayerAddrs(prev => {
        const taken = new Set(players);
        let seatIdx = 0;
        while (seatIdx < 10 && taken.has(players[seatIdx])) seatIdx++;
        const next = [...prev];
        while (next.length <= seatIdx) next.push('');
        next[seatIdx] = addr;
        return next;
      });
    } catch {}
  };

  // When shared game state updates, ensure local engine is created/updated for rendering & actions
  useEffect(() => {
    if (!sharedGame?.gameState) return;
    const gs = sharedGame.gameState;
    if (!engine) {
      // Initialize engine with stub players then load state
      const names = gs.players.map(p => p.name);
      const initEngine = new PokerEngine(
        names,
        gs.players[0]?.chips ?? 1000,
        false,
        gs.smallBlind,
        gs.bigBlind
      );
      initEngine.loadState(gs);
      setEngine(initEngine);
    } else {
      engine.loadState(gs);
    }
  }, [sharedGame?.gameState]);

  // Persist latest sharedGame snapshot to localStorage for instant reload hydration
  useEffect(() => {
    if (sharedGame) {
      try {
        localStorage.setItem(savedKey, JSON.stringify(sharedGame));
      } catch {}
    }
  }, [sharedGame]);

  // Host-only: when a hand reaches showdown, submit results via backend batch endpoint
  useEffect(() => {
    if (!isHost || !isLeader) return;
    const sd = sharedGame?.showdownData;
    const seq = sharedGame?.handSeq;
    if (!sd || !seq) return;
    const key = String(seq);
    if (submittedHandSeqs.current.has(key)) return;
    submittedHandSeqs.current.add(key);

    try {
      const winnerNames = new Set((sd.winners || []).map((w: Player) => (w && (w as any).name) ? (w as any).name : w?.name).filter(Boolean));
      const addrs: string[] = [];
      const wins: boolean[] = [];
      for (let i = 0; i < players.length; i++) {
        const name = players[i];
        if (!name) continue;
        const addr = (playerAddrs[i] || '').trim();
        if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) continue;
        addrs.push(addr);
        wins.push(winnerNames.has(name));
      }
      if (!addrs.length) {
        console.warn('[Submit] No valid player addresses to submit for hand', key);
        return;
      }
      const rid = `${roomId}:${key}`;
      const deckHash = (sharedGame as any)?.deckHash as string | undefined;
      submitHandBatch({
        players: addrs,
        winners: wins,
        roomId,
        handSeq: key,
        deckHash,
        requestId: rid,
      })
        .then((res) => {
          if (!res.ok) {
            console.error('[Batch Submit] Failed for hand', key, res.error);
          } else {
            console.log('[Batch Submit] Success tx:', res.txHash);
          }
        })
        .catch((e) => {
          console.error('[Batch Submit] Error for hand', key, e);
        });
    } catch (e) {
      console.error('[Submit] Unexpected error preparing batch submission:', e);
    }
  }, [isHost, isLeader, sharedGame?.showdownData, sharedGame?.handSeq, players, playerAddrs]);

  const startGame = async (playerNames: string[], settings?: GameSettings) => {
    // Only leader host can start the game
    if (!(isHost && isLeader)) return;
    const desiredPlayers = (playerNames && playerNames.length >= 2 ? playerNames : players).slice(0, 10);
    if (desiredPlayers.length < 2) return;

    // If no creator, claim host role
    if (!lobby.creatorId) {
      setLobby({ ...lobby, creatorId: clientId });
    }
    if (lobby.creatorId && lobby.creatorId !== clientId) {
      console.warn('Only the game creator can start the game');
      return;
    }

    const gameSettings = settings ? {
      startingChips: settings.startingChips || 1000,
      smallBlind: settings.smallBlind || 10,
      bigBlind: settings.bigBlind || 20,
      turnTimeSeconds: settings.turnTimeSeconds || 30
    } : {
      startingChips: 1000,
      smallBlind: 10,
      bigBlind: 20,
      turnTimeSeconds: 30
    };
    setGameSettings(gameSettings);

    // Publish lobby (players/settings) pre-start
    setPlayers(desiredPlayers);
    setLobby({ creatorId: clientId, started: false, settings: gameSettings });

    // Initialize engine without starting first hand – we will start once deck arrives
    const newEngine = new PokerEngine(
      desiredPlayers, 
      gameSettings.startingChips, 
      false,
      gameSettings.smallBlind,
      gameSettings.bigBlind
    );
    setEngine(newEngine);
    try {
      setIsDealing(true);
      const embeddedWallet = wallets?.find((w) => (w as any).walletClientType === 'privy') as ConnectedWallet | undefined;
      if (!embeddedWallet) throw new Error('No embedded wallet available. Please log in.');
      const { packedDeck, txHash, sequence, deckHash } = await requestShuffleWithEmbeddedWallet(embeddedWallet);
      console.log('Shuffle successful, starting game with deck:', packedDeck);
      newEngine.startNewHandWithPackedDeck(packedDeck);
      const gs = newEngine.getState();
      console.log('Game state after starting hand:', gs);
      setGameState(gs);
      setSharedGame({ gameState: gs, lastTxHash: txHash ?? null, showdownData: null, handSeq: sequence?.toString() ?? '0', deckHash, handCounter: 1 });
      setLobby({ creatorId: clientId, started: true, settings: gameSettings });
      setGameStarted(true);
      console.log('Game started successfully');
    } catch (err) {
      console.error('Failed to start game - shuffle error:', err);
      // Don't start the game if shuffle fails
      setEngine(null);
      const code = (err as any)?.code ?? 'TX_ERROR';
      const message = (err as any)?.message || 'Failed to shuffle deck on-chain. Please try again.';
      setDealingError({ code, message });
      setLastShuffleAction('startGame');
      return;
    } finally {
      setIsDealing(false);
    }
  };
  
  const performAction = (action: PlayerAction, amount?: number, opts?: { fromRemote?: boolean }) => {
    const isLeaderHost = isHost && isLeader;
    // Clear deadline while processing only by leader host
    if (isLeaderHost) setTurnDeadline(null);
    // Non-leader or non-host: submit action request
    if (!isLeaderHost) {
      const seatName = ((typeof sessionStorage !== 'undefined' && sessionStorage.getItem('mySeatName')) || nickname || 'Anonymous').trim();
      const seq = (actionReq?.seq || 0) + 1;
      setActionReq({ seq, byName: seatName, action, amount });
      return;
    }
    // Host applies action
    if (!engine) return;
    // If this is a local action (not from remote), ensure host controls only their seat
    if (!opts?.fromRemote) {
      const seatName = ((typeof sessionStorage !== 'undefined' && sessionStorage.getItem('mySeatName')) || nickname || '').trim();
      const stateNow = engine.getState();
      const currentName = stateNow.players[stateNow.currentPlayerIndex]?.name;
      if (!seatName || currentName !== seatName) {
        console.warn('Ignoring action: not your seat\'s turn');
        return;
      }
    }
    const idx = engine.getCurrentPlayerIndex();
    switch (action) {
      case PlayerAction.Fold:
        engine.fold(idx);
        break;
      case PlayerAction.Check:
        engine.check(idx);
        break;
      case PlayerAction.Call:
        engine.call(idx);
        break;
      case PlayerAction.Raise:
        if (typeof amount === 'number') engine.bet(idx, amount);
        break;
      case PlayerAction.AllIn:
        engine.allIn(idx);
        break;
    }
    const gs = engine.getState();
    // If reached showdown, capture data
    if (gs.stage === GameStage.Showdown) {
      const data = engine.getShowdownData();
      const evalObj: Record<number, any> = {};
      data.evaluations.forEach((v, k) => (evalObj[k] = v));
      setSharedGame({ ...(sharedGame as any), gameState: gs, lastTxHash, showdownData: { winners: data.winners, evaluations: evalObj } });
    } else {
      setSharedGame({ ...(sharedGame as any), gameState: gs, lastTxHash, showdownData: null });
    }
  };

  // Clear deadline as soon as we enter invalid states for counting down
  useEffect(() => {
    if (!gameStarted || isDealing || !gameState || gameState.stage === GameStage.Showdown) {
      if (turnDeadline !== null) setTurnDeadline(null);
    }
  }, [gameStarted, isDealing, gameState?.stage]);

  // Interval-based auto action when countdown expires (robust)
  useEffect(() => {
    const isLeaderHost = isHost && isLeader;
    if (!isLeaderHost) return;
    if (!turnDeadline || !gameStarted || isDealing || !gameState || gameState.stage === GameStage.Showdown) return;

    const id = setInterval(() => {
      if (Date.now() < turnDeadline) return;
      // Time is up – stop interval immediately to prevent duplicate triggers
      clearInterval(id);
      // Decide default action
      const idx = engine ? engine.getCurrentPlayerIndex() : currentPlayerIndex;
      if (idx == null || idx < 0) return;
      const player = gameState.players[idx];
      if (!player) return;
      const toCall = gameState.currentBet - player.currentBet;

      // Only leader host triggers the auto-action
      performAction(toCall === 0 ? PlayerAction.Check : PlayerAction.Fold, undefined, { fromRemote: true });
      setTurnDeadline(null);
    }, 200);

    return () => clearInterval(id);
  }, [turnDeadline, gameState, engine, currentPlayerIndex, isHost, isLeader, gameStarted, isDealing]);

  // Host processes remote action requests
  useEffect(() => {
    if (!isHost || !isLeader || !engine) return;
    if (!actionReq || actionReq.seq === 0) return;
    if (actionProcessed >= actionReq.seq) return;
    const state = engine.getState();
    const current = state.players[state.currentPlayerIndex];
    // Only accept request if it's that player's turn (by name)
    if (actionReq.byName && current && current.name && current.name !== actionReq.byName) {
      return; // ignore out-of-turn
    }
    performAction(actionReq.action as PlayerAction, actionReq.amount, { fromRemote: true });
    setActionProcessed(actionReq.seq);
  }, [actionReq, actionProcessed, isHost, isLeader, engine]);

  const nextHand = async () => {
    if (!engine || !isHost || !isLeader) return;
    engine.settlePot();
    // After settling, request a new shuffled deck using embedded wallet
    try {
      setIsDealing(true);
      const embeddedWallet = wallets?.find((w) => (w as any).walletClientType === 'privy') as ConnectedWallet | undefined;
      if (!embeddedWallet) throw new Error('No embedded wallet available. Please log in.');
      const { packedDeck, txHash, sequence, deckHash } = await requestShuffleWithEmbeddedWallet(embeddedWallet);
      engine.startNewHandWithPackedDeck(packedDeck);
      const gs = engine.getState();
      const nextCount = (sharedGame as any)?.handCounter ? (sharedGame as any).handCounter + 1 : 1;
      setSharedGame({ gameState: gs, lastTxHash: txHash ?? null, showdownData: null, handSeq: sequence?.toString() ?? '0', deckHash, handCounter: nextCount });
    } catch (err) {
      console.error('Failed to shuffle for next hand:', err);
      const code = (err as any)?.code ?? 'TX_ERROR';
      const message = (err as any)?.message || 'Shuffle failed for next hand. Please retry.';
      setDealingError({ code, message });
      setLastShuffleAction('nextHand');
    } finally {
      setIsDealing(false);
    }
  };

  // Manual reshuffle function for table creator
  const manualReshuffle = async () => {
    if (!isHost) {
      alert('Only the table creator can request a manual reshuffle.');
      return;
    }
    if (!isLeader) {
      alert('Only the active host tab can request a manual reshuffle.');
      return;
    }
    
    try {
      setIsDealing(true);
      const embeddedWallet = wallets?.find((w) => (w as any).walletClientType === 'privy') as ConnectedWallet | undefined;
      if (!embeddedWallet) throw new Error('No embedded wallet available. Please log in.');
      const { packedDeck, txHash, sequence, deckHash } = await requestShuffleWithEmbeddedWallet(embeddedWallet);
      
      if (engine) {
        // If game is active, start new hand with shuffled deck
        engine.startNewHandWithPackedDeck(packedDeck);
        const gs = engine.getState();
        const nextCount = (sharedGame as any)?.handCounter ? (sharedGame as any).handCounter + 1 : 1;
        setSharedGame({ gameState: gs, lastTxHash: txHash ?? null, showdownData: null, handSeq: sequence?.toString() ?? '0', deckHash, handCounter: nextCount });
        alert('Manual reshuffle successful! New hand started.');
      } else {
        // If no active game, just confirm shuffle worked
        setLastTxHash(txHash ?? null);
        alert('Manual reshuffle successful! You can now start the game.');
      }
    } catch (err) {
      console.error('Manual reshuffle failed:', err);
      const code = (err as any)?.code ?? 'TX_ERROR';
      const message = (err as any)?.message || 'Manual reshuffle failed. Please try again.';
      setDealingError({ code, message });
      setLastShuffleAction('manualReshuffle');
    } finally {
      setIsDealing(false);
    }
  };
  
  const retryLastShuffle = async () => {
    if (!isHost || !isLeader) return;
    const action = lastShuffleAction;
    if (!action) return;
    setDealingError(null);
    if (action === 'startGame') {
      await startGame(players, tableSettings ?? undefined);
    } else if (action === 'nextHand') {
      await nextHand();
    } else if (action === 'manualReshuffle') {
      await manualReshuffle();
    }
  };
  return <GameContext.Provider value={{
    engine,
    gameState,
    startGame,
    performAction,
    nextHand,
    createTable,
    joinTable,
    isHost,
    tableSettings,
    gameStarted,
    isGameStarted: gameStarted,
    players,
    beginGame,
    showdownData,
    currentPlayerIndex,
    turnDeadline,
      isDealing,
    lastTxHash,
    gameSettings,
    manualReshuffle,
  }}>
    {children}
    {/* Dealing overlay */}
    {isDealing && !dealingError && (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
        <div className="bg-gray-800 px-4 py-3 rounded shadow-lg flex items-center gap-2">
          <svg className="animate-spin h-5 w-5 text-purple-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z"></path>
          </svg>
          <span className="text-white text-sm">Dealing cards on-chain…</span>
        </div>
      </div>
    )}
    {dealingError && (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
        <div className="bg-gray-800 px-5 py-4 rounded shadow-lg max-w-md w-[92%] text-white">
          <div className="font-semibold mb-2">Transaction failed</div>
          <div className="text-sm mb-3">{dealingError.message}</div>
          {dealingError.code === 'INSUFFICIENT_FUNDS' && (
            <div className="text-xs text-gray-300 mb-3">
              Fund your Monad Testnet wallet with test ETH, then click Retry.
            </div>
          )}
          <div className="flex gap-2 justify-end">
            <button className="px-3 py-1 rounded bg-gray-700 hover:bg-gray-600" onClick={() => setDealingError(null)}>Close</button>
            {isHost && isLeader ? (
              <button className="px-3 py-1 rounded bg-purple-600 hover:bg-purple-500" onClick={retryLastShuffle}>Retry</button>
            ) : (
              <button className="px-3 py-1 rounded bg-gray-600 cursor-not-allowed" disabled>
                {isHost ? 'Another host tab is active…' : 'Waiting for host…'}
              </button>
            )}
          </div>
        </div>
      </div>
    )}
  </GameContext.Provider>;
};
