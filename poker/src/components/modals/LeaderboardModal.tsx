import React, { useEffect, useMemo, useState } from 'react';
import { getBackendBase } from '../../lib/scoreApi';

type Item = {
  player: string;
  score: string; // stringified bigint
  transactions: string; // stringified bigint
};

type RecentHand = {
  handId: string;
  tableId: string;
  deckHash: string;
  requestId: string;
  players: string[];
  winners: boolean[];
  timestamp: number;
};

type SearchResult = {
  ok: boolean;
  address: string;
  score: string;
  transactions: string;
};

interface Props {
  isOpen: boolean;
  onClose: () => void;
  limit?: number;
}

export const LeaderboardModal: React.FC<Props> = ({ isOpen, onClose, limit = 50 }) => {
  const [activeTab, setActiveTab] = useState<'top' | 'global' | 'recent' | 'search'>('top');

  // Top tab state
  const [items, setItems] = useState<Item[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  // Global tab state
  const [globalItems, setGlobalItems] = useState<Item[]>([]);
  const [globalLoading, setGlobalLoading] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [globalUpdatedAt, setGlobalUpdatedAt] = useState<string | null>(null);

  // Recent tab state
  const [recent, setRecent] = useState<RecentHand[]>([]);
  const [recentLoading, setRecentLoading] = useState(false);
  const [recentError, setRecentError] = useState<string | null>(null);

  // Search tab state
  const [addressInput, setAddressInput] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchData, setSearchData] = useState<SearchResult | null>(null);
  const [searchScope, setSearchScope] = useState<'game' | 'global'>('game');

  const backendBase = useMemo(() => getBackendBase(), []);

  useEffect(() => {
    if (!isOpen || activeTab !== 'top') return;
    const controller = new AbortController();
    const fetchData = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const url = `${backendBase}/api/leaderboard?limit=${limit}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!data?.ok) throw new Error(data?.error || 'Failed');
        setItems(Array.isArray(data.items) ? data.items : []);
        setUpdatedAt(data.updatedAt || null);
      } catch (e: any) {
        setError(e?.message || String(e));
        setItems([]);
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
    return () => controller.abort();
  }, [isOpen, activeTab, backendBase, limit]);

  // Fetch global leaderboard when switching to Global tab
  useEffect(() => {
    if (!isOpen || activeTab !== 'global') return;
    const controller = new AbortController();
    const fetchGlobal = async () => {
      setGlobalLoading(true);
      setGlobalError(null);
      try {
        const url = `${backendBase}/api/leaderboard/global?limit=${limit}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!data?.ok) throw new Error(data?.error || 'Failed');
        setGlobalItems(Array.isArray(data.items) ? data.items : []);
        setGlobalUpdatedAt(data.updatedAt || null);
      } catch (e: any) {
        setGlobalError(e?.message || String(e));
        setGlobalItems([]);
      } finally {
        setGlobalLoading(false);
      }
    };
    fetchGlobal();
    return () => controller.abort();
  }, [isOpen, activeTab, backendBase, limit]);

  // Fetch recent hands when switching to Recent tab
  useEffect(() => {
    if (!isOpen || activeTab !== 'recent') return;
    const controller = new AbortController();
    const fetchRecent = async () => {
      setRecentLoading(true);
      setRecentError(null);
      try {
        const url = `${backendBase}/api/leaderboard/recent?limit=${limit}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!data?.ok) throw new Error(data?.error || 'Failed');
        setRecent(Array.isArray(data.items) ? data.items : []);
      } catch (e: any) {
        setRecentError(e?.message || String(e));
        setRecent([]);
      } finally {
        setRecentLoading(false);
      }
    };
    fetchRecent();
    return () => controller.abort();
  }, [isOpen, activeTab, backendBase, limit]);

  if (!isOpen) return null;

  const short = (addr: string) => addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : '';

  const shownUpdatedAt = activeTab === 'top' ? updatedAt : activeTab === 'global' ? globalUpdatedAt : null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 rounded-xl w-full max-w-xl p-4 sm:p-6 shadow-lg">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl sm:text-2xl font-bold text-purple-300">Leaderboard</h2>
          <button onClick={onClose} className="text-gray-300 hover:text-white">Close</button>
        </div>
        <div className="flex items-center gap-2 mb-3 text-sm">
          <button
            className={`px-2 py-1 rounded ${activeTab === 'top' ? 'bg-purple-700 text-white' : 'bg-gray-800 text-gray-300'}`}
            onClick={() => setActiveTab('top')}
          >Top</button>
          <button
            className={`px-2 py-1 rounded ${activeTab === 'global' ? 'bg-purple-700 text-white' : 'bg-gray-800 text-gray-300'}`}
            onClick={() => setActiveTab('global')}
          >Global</button>
          <button
            className={`px-2 py-1 rounded ${activeTab === 'recent' ? 'bg-purple-700 text-white' : 'bg-gray-800 text-gray-300'}`}
            onClick={() => setActiveTab('recent')}
          >Recent</button>
          <button
            className={`px-2 py-1 rounded ${activeTab === 'search' ? 'bg-purple-700 text-white' : 'bg-gray-800 text-gray-300'}`}
            onClick={() => setActiveTab('search')}
          >Search</button>
        </div>
        <div className="flex items-center justify-between mb-3 text-xs text-gray-400">
          <span>{shownUpdatedAt ? `Updated: ${new Date(shownUpdatedAt).toLocaleString()}` : ''}</span>
          <button
            onClick={() => {
              if (activeTab === 'top') {
                // refresh top
                setIsLoading(true);
                setError(null);
                fetch(`${backendBase}/api/leaderboard?limit=${limit}&force=1`).then(async (r) => {
                  if (!r.ok) throw new Error(`HTTP ${r.status}`);
                  const d = await r.json();
                  if (!d?.ok) throw new Error(d?.error || 'Failed');
                  setItems(Array.isArray(d.items) ? d.items : []);
                  setUpdatedAt(d.updatedAt || null);
                }).catch((e) => {
                  setError(e?.message || String(e));
                  setItems([]);
                }).finally(() => setIsLoading(false));
              } else if (activeTab === 'global') {
                // refresh global
                setGlobalLoading(true);
                setGlobalError(null);
                fetch(`${backendBase}/api/leaderboard/global?limit=${limit}&force=1`).then(async (r) => {
                  if (!r.ok) throw new Error(`HTTP ${r.status}`);
                  const d = await r.json();
                  if (!d?.ok) throw new Error(d?.error || 'Failed');
                  setGlobalItems(Array.isArray(d.items) ? d.items : []);
                  setGlobalUpdatedAt(d.updatedAt || null);
                }).catch((e) => {
                  setGlobalError(e?.message || String(e));
                  setGlobalItems([]);
                }).finally(() => setGlobalLoading(false));
              } else if (activeTab === 'recent') {
                // refresh recent
                setRecentLoading(true);
                setRecentError(null);
                fetch(`${backendBase}/api/leaderboard/recent?limit=${limit}`).then(async (r) => {
                  if (!r.ok) throw new Error(`HTTP ${r.status}`);
                  const d = await r.json();
                  if (!d?.ok) throw new Error(d?.error || 'Failed');
                  setRecent(Array.isArray(d.items) ? d.items : []);
                }).catch((e) => {
                  setRecentError(e?.message || String(e));
                  setRecent([]);
                }).finally(() => setRecentLoading(false));
              }
            }}
            className="px-2 py-1 rounded bg-gray-800 hover:bg-gray-700"
          >Refresh</button>
        </div>
        {/* Content: Top */}
        {activeTab === 'top' && (
          <>
            {isLoading && <div className="text-gray-300 text-sm">Loading…</div>}
            {error && <div className="text-red-400 text-sm mb-2">{error}</div>}
            {!isLoading && !error && (
              <div className="max-h-96 overflow-y-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-gray-400">
                    <tr>
                      <th className="py-2">#</th>
                      <th className="py-2">Player</th>
                      <th className="py-2 text-right">Score</th>
                      <th className="py-2 text-right">Hands</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.length === 0 && (
                      <tr>
                        <td colSpan={4} className="py-4 text-center text-gray-400">No entries yet</td>
                      </tr>
                    )}
                    {items.map((it, idx) => (
                      <tr key={it.player} className="border-t border-gray-800">
                        <td className="py-2 w-8 text-gray-400">{idx + 1}</td>
                        <td className="py-2">
                          <div className="flex items-center gap-2">
                            <span className="font-mono">{short(it.player)}</span>
                            <button
                              className="text-[11px] px-2 py-0.5 rounded bg-gray-800 hover:bg-gray-700"
                              onClick={() => navigator.clipboard.writeText(it.player)}
                            >Copy</button>
                          </div>
                        </td>
                        <td className="py-2 text-right font-semibold">{it.score}</td>
                        <td className="py-2 text-right">{it.transactions}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {/* Content: Global */}
        {activeTab === 'global' && (
          <>
            {globalLoading && <div className="text-gray-300 text-sm">Loading…</div>}
            {globalError && <div className="text-red-400 text-sm mb-2">{globalError}</div>}
            {!globalLoading && !globalError && (
              <div className="max-h-96 overflow-y-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-gray-400">
                    <tr>
                      <th className="py-2">#</th>
                      <th className="py-2">Player</th>
                      <th className="py-2 text-right">Score</th>
                      <th className="py-2 text-right">Hands</th>
                    </tr>
                  </thead>
                  <tbody>
                    {globalItems.length === 0 && (
                      <tr>
                        <td colSpan={4} className="py-4 text-center text-gray-400">No entries yet</td>
                      </tr>
                    )}
                    {globalItems.map((it, idx) => (
                      <tr key={it.player} className="border-t border-gray-800">
                        <td className="py-2 w-8 text-gray-400">{idx + 1}</td>
                        <td className="py-2">
                          <div className="flex items-center gap-2">
                            <span className="font-mono">{short(it.player)}</span>
                            <button
                              className="text-[11px] px-2 py-0.5 rounded bg-gray-800 hover:bg-gray-700"
                              onClick={() => navigator.clipboard.writeText(it.player)}
                            >Copy</button>
                          </div>
                        </td>
                        <td className="py-2 text-right font-semibold">{it.score}</td>
                        <td className="py-2 text-right">{it.transactions}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {/* Content: Recent */}
        {activeTab === 'recent' && (
          <>
            {recentLoading && <div className="text-gray-300 text-sm">Loading…</div>}
            {recentError && <div className="text-red-400 text-sm mb-2">{recentError}</div>}
            {!recentLoading && !recentError && (
              <div className="max-h-96 overflow-y-auto">
                {recent.length === 0 ? (
                  <div className="text-center text-gray-400 py-4">No hands yet</div>
                ) : (
                  <ul className="space-y-2">
                    {recent.map((h, idx) => {
                      const winnerAddrs = (h.players || []).filter((_, i) => (h.winners || [])[i]);
                      return (
                        <li key={`${h.requestId}-${idx}`} className="border border-gray-800 rounded p-3">
                          <div className="flex justify-between text-xs text-gray-400">
                            <span>{new Date(h.timestamp).toLocaleString()}</span>
                            <span>Table {h.tableId}</span>
                          </div>
                          <div className="text-sm mt-1">Hand {h.handId}</div>
                          <div className="text-xs mt-1">
                            Players:{' '}
                            {(h.players || []).map((p) => (
                              <span key={p} className="font-mono mr-2">{short(p)}</span>
                            ))}
                          </div>
                          <div className="text-xs mt-1">
                            Winners:{' '}
                            {winnerAddrs.length ? (
                              winnerAddrs.map((w) => (
                                <span key={w} className="font-mono mr-2 text-green-400">{short(w)}</span>
                              ))
                            ) : (
                              <span className="text-gray-500">—</span>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
          </>
        )}

        {/* Content: Search */}
        {activeTab === 'search' && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <input
                value={addressInput}
                onChange={(e) => setAddressInput(e.target.value)}
                placeholder="0xabc... address"
                className="flex-1 px-2 py-1 rounded bg-gray-800 text-gray-100 outline-none"
              />
              <select
                value={searchScope}
                onChange={(e) => setSearchScope(e.target.value as 'game' | 'global')}
                className="px-2 py-1 rounded bg-gray-800 text-gray-100"
                title="Search scope"
              >
                <option value="game">Per-game</option>
                <option value="global">Global</option>
              </select>
              <button
                className="px-2 py-1 rounded bg-gray-800 hover:bg-gray-700"
                onClick={() => {
                  if (!addressInput) return;
                  setSearchLoading(true);
                  setSearchError(null);
                  setSearchData(null);
                  const path = searchScope === 'global' ? '/api/leaderboard/search-global' : '/api/leaderboard/search';
                  fetch(`${backendBase}${path}?address=${encodeURIComponent(addressInput)}`).then(async (r) => {
                    if (!r.ok) throw new Error(`HTTP ${r.status}`);
                    const d = await r.json();
                    if (!d?.ok) throw new Error(d?.error || 'Failed');
                    setSearchData(d as SearchResult);
                  }).catch((e) => {
                    setSearchError(e?.message || String(e));
                    setSearchData(null);
                  }).finally(() => setSearchLoading(false));
                }}
              >Search</button>
            </div>
            {searchLoading && <div className="text-gray-300 text-sm">Loading…</div>}
            {searchError && <div className="text-red-400 text-sm mb-2">{searchError}</div>}
            {searchData && (
              <div className="border border-gray-800 rounded p-3 text-sm">
                <div className="mb-1"><span className="text-gray-400">Address:</span> <span className="font-mono">{short(searchData.address)}</span></div>
                <div className="mb-1"><span className="text-gray-400">Score:</span> {searchData.score}</div>
                <div className="mb-1"><span className="text-gray-400">Hands:</span> {searchData.transactions}</div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
