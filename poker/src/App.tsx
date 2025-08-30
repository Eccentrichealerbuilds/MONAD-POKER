import { useState, useEffect, type FC } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { ReactTogether } from 'react-together';
import { GameProvider } from './context/GameContext';
import LandingPage from './components/LandingPage';
import { GameTable } from './components/GameTable';
import { GamePage } from './components/GamePage';
import { LeaderboardPage } from './components/LeaderboardPage';

// Auto-select layout based on screen width (< 1024px considered mobile)
const GameSelector: FC = () => {
  const [isMobile, setIsMobile] = useState<boolean>(window.innerWidth < 1024);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 1024);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return isMobile ? <GameTable /> : <GamePage />;
};



export function App() {
  // Ensure router works under a subpath like /poker in both dev and prod
  const path = typeof window !== 'undefined' ? window.location.pathname : '/';
  const basename = path.startsWith('/poker') ? '/poker' : '';
  // Multisynq React Together configuration
  const apiKey = ((import.meta as any).env?.VITE_MULTISYNQ_API_KEY
    || (import.meta as any).env?.VITE_REACT_TOGETHER_API_KEY
    || '') as string;
  const appId = 'com.monad.poker';

  const SessionWrapper: FC<{ children: React.ReactNode }> = ({ children }) => {
    const location = useLocation();
    const params = new URLSearchParams(location.search);
    let room = params.get('room') || params.get('lobbyId') || params.get('id');
    if (!room) {
      const match = location.pathname.match(/(?:^|\/)game\/([^/]+)/);
      if (match) {
        room = match[1];
      }
    }
    if (!room) {
      let clientId = localStorage.getItem('clientId');
      if (!clientId) {
        clientId = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
          ? (crypto.randomUUID() as string)
          : Math.random().toString(36).slice(2);
        try { localStorage.setItem('clientId', clientId) } catch {}
      }
      room = `local-${clientId.slice(0, 8)}`;
    }
    const sessionName = `poker-lobby-${room}`;
    if (!apiKey) {
      console.warn('[ReactTogether] API key is missing. Set VITE_MULTISYNQ_API_KEY (or VITE_REACT_TOGETHER_API_KEY) in poker/.env to enable real-time sync.');
    }
    return (
      <ReactTogether
        key={sessionName}
        sessionParams={{ apiKey, appId, name: sessionName, password: 'pokernads-secure-2024' }}
      >
        {children}
      </ReactTogether>
    );
  };

  return (
    <Router basename={basename}>
      <SessionWrapper>
        <GameProvider>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/game/:roomId" element={<GameSelector />} />
            <Route path="/leaderboard" element={<LeaderboardPage />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </GameProvider>
      </SessionWrapper>
    </Router>
  );
}