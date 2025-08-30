import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

import { Header } from './Header';
import { GameInfo } from './GameInfo';
import { PokerTable } from './PokerTable';
import { PlayerControls } from './PlayerControls';
import { Chat } from './Chat';
import { ShowdownModal } from './ShowdownModal';
import { PlayerJoinModal } from './modals/PlayerJoinModal';
import { useGame } from '../context/GameContext';

export const GamePage = () => {
  const {
    isGameStarted,
    gameState,
    showdownData,
    nextHand,
    tableSettings,
    players,
    createTable,
    joinTable,
    isHost,
    beginGame
  } = useGame();

  const myNick = (localStorage.getItem('playerName') || '').trim();

  const [isChatOpen, setIsChatOpen] = useState(false);
  const { roomId } = useParams();
  const [isCreating, setIsCreating] = useState(false);

  // Auto-create table in this session if we navigated here from LandingPage
  useEffect(() => {
    if (tableSettings) return; // already created
    try {
      const raw = sessionStorage.getItem('pendingCreate');
      if (!raw) return;
      const data = JSON.parse(raw);
      if (!data || data.roomId !== roomId) return;
      // prevent duplicate
      sessionStorage.removeItem('pendingCreate');
      setIsCreating(true);
      createTable(data.nickname, data.stack, data.sb, data.bb);
      // slight delay for visual feedback
      setTimeout(() => setIsCreating(false), 800);
    } catch {}
  }, [roomId, tableSettings, createTable]);

  // Show waiting/creation states prior to table being initialized
  const needsSetup = !tableSettings;
  const needsJoin = !!tableSettings && !players.includes(myNick);

  if (needsSetup) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-900 text-white">
        <div className="text-center">
          <div className="text-lg font-semibold mb-2">{isCreating ? 'Creating table…' : 'Waiting for host to create the table…'}</div>
          <div className="text-sm text-gray-400">Share the room link with friends to join.</div>
        </div>
      </div>
    );
  }
  if (needsJoin) {
    return <PlayerJoinModal isOpen={true} onJoin={joinTable} />;
  }

  if (!isGameStarted) {
    // Non-hosts wait; host proceeds to show table with Start button
    if (!isHost) {
      return <div className="flex items-center justify-center min-h-screen bg-gray-900 text-white">Waiting for host…</div>;
    }
  }

  return <div className="bg-gray-900 text-white min-h-screen">
    <div className="container mx-auto px-4 py-6">
      <Header />
      <GameInfo />
      {/* Host start button */}
      {isHost && !isGameStarted && players.length >= 2 && (
        <div className="mb-4 text-center">
          <button onClick={beginGame} className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded">Start Game</button>
        </div>
      )}
        <PokerTable />
        <PlayerControls />
        {/* Chat Button */}
        <div className="fixed bottom-6 right-6">
          <button onClick={() => setIsChatOpen(true)} className="bg-purple-600 hover:bg-purple-700 text-white p-3 rounded-full shadow-lg" aria-label="Open chat">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            </svg>
          </button>
        </div>
        {/* Chat Modal */}
        <Chat isOpen={isChatOpen} onClose={() => setIsChatOpen(false)} />
        {/* Showdown Modal */}
        {gameState && <ShowdownModal isOpen={!!showdownData} gameState={gameState} data={showdownData as any} onNextHand={nextHand} />}
      </div>
    </div>;
};