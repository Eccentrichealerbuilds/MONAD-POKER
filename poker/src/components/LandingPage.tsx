import { FC, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { WalletInfo } from './WalletInfo';
import AuthComponent from './AuthComponent';
import { useMonadGamesUser } from '../hooks/useMonadGamesUser';
import { TableSetupModal } from './modals/TableSetupModal';
import { JoinLobbyModal } from './modals/JoinLobbyModal';

export const LandingPage: FC = () => {
  const navigate = useNavigate();
  const { login, authenticated, user } = usePrivy();
  const { wallets } = useWallets();
  const [playerAddress, setPlayerAddress] = useState<string>('');
  const { user: monadUser, hasUsername } = useMonadGamesUser(playerAddress);
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  
  // Get embedded wallet if exists
  const embeddedWallet = wallets?.find(wallet => wallet.walletClientType === 'privy');

  const handleCreateTable = () => {
    if (!authenticated || !embeddedWallet) {
      login();
      return;
    }
    setShowCreate(true);
  };

  const handleCreateFromModal = (nickname: string, stack: number, sb: number, bb: number) => {
    setShowCreate(false);
    const roomId = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
      ? (crypto.randomUUID() as string).slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
    try {
      sessionStorage.setItem('pendingCreate', JSON.stringify({ roomId, nickname: nickname.trim() || 'Player', stack, sb, bb }));
    } catch {}
    navigate(`/game/${roomId}`);
  };

  const extractRoomId = (input: string): string | null => {
    const s = (input || '').trim();
    if (!s) return null;
    // Try to parse full URL
    try {
      const url = new URL(s);
      const qp = url.searchParams.get('room') || url.searchParams.get('lobbyId') || url.searchParams.get('id');
      if (qp) return qp;
      const m = url.pathname.match(/(?:^|\/)(?:game|lobby)\/([A-Za-z0-9_-]+)/);
      if (m) return m[1];
    } catch {}
    // Fallback: accept simple code
    const code = s.replace(/[^A-Za-z0-9_-]/g, '');
    return code.length ? code : null;
  };

  const handleJoinClick = () => setShowJoin(true);
  const handleJoinFromModal = (roomInput: string) => {
    setShowJoin(false);
    const id = extractRoomId(roomInput);
    if (id) navigate(`/game/${id}`);
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center justify-center p-4">
      <div className="max-w-md w-full space-y-8 text-center">
        <h1 className="text-4xl font-bold mb-8">Monad Poker</h1>
        <p className="text-gray-400 mb-8">
          Play poker with friends using on-chain entropy for verifiable card dealing
        </p>
        <div className="flex justify-center">
          <AuthComponent onAddressChange={setPlayerAddress} />
        </div>
        
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              onClick={handleCreateTable}
              className="w-full bg-purple-600 hover:bg-purple-700 text-white font-bold py-3 px-6 rounded-lg transition-colors"
            >
              {authenticated ? 'Create Table' : 'Login to Create'}
            </button>
            <button
              onClick={handleJoinClick}
              className="w-full bg-gray-700 hover:bg-gray-600 text-white font-bold py-3 px-6 rounded-lg transition-colors"
            >
              Join Table
            </button>
          </div>
          <div className="flex justify-center">
            <button
              onClick={() => navigate('/leaderboard')}
              className="bg-gray-800 hover:bg-gray-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
            >
              Leaderboard
            </button>
          </div>
          
          {authenticated && (
            <div className="space-y-4">
              <div className="text-sm text-gray-400">
                Playing as: {hasUsername && monadUser ? monadUser.username : (user?.email?.address || 'Anonymous')}
              </div>
              <WalletInfo />
            </div>
          )}
        </div>
      </div>
      {showCreate && (
        <TableSetupModal
          isOpen={showCreate}
          onCreate={handleCreateFromModal}
        />
      )}
      {showJoin && (
        <JoinLobbyModal
          isOpen={showJoin}
          onJoin={handleJoinFromModal}
          onClose={() => setShowJoin(false)}
        />
      )}
    </div>
  );
};
export default LandingPage;