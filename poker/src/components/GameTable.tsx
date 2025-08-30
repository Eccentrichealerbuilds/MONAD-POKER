import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useGame } from '../context/GameContext';
import { Card, GameStage, PlayerAction, Player } from '../types';
import { ShowdownModal } from './ShowdownModal';
import { PlayerJoinModal } from './modals/PlayerJoinModal';

// Helper function to format card for display
const formatCard = (card: Card) => {
  let rank;
  switch (card.rank) {
    case 11: rank = 'J'; break;
    case 12: rank = 'Q'; break;
    case 13: rank = 'K'; break;
    case 14: rank = 'A'; break;
    default: rank = card.rank;
  }
  return { value: rank, suit: card.suit };
};

// Card Components
const PlayingCard = ({ value, suit, className = 'w-6 h-9 sm:w-8 sm:h-12' }: { value: string | number; suit: string; className?: string; }) => {
  const suitColor = suit === '♥' || suit === '♦' ? 'text-red-500' : 'text-black';
  return (
    <div className={`${className} bg-white rounded flex items-center justify-center text-sm sm:text-lg font-bold`}>
      <span className={suitColor}>
        {value}{suit}
      </span>
    </div>
  );
};

const HiddenCard = ({ className = 'w-6 h-9 sm:w-8 sm:h-12' }: { className?: string; }) => (
  <div className={`${className} bg-blue-800 rounded flex items-center justify-center text-sm sm:text-lg`}>
    <span className="text-blue-500">?</span>
  </div>
);

// Player Position Component
const PlayerPosition = ({ player, isActive, isShowdown, reveal }: { player: Player | null; isActive: boolean; isShowdown: boolean; reveal: boolean; }) => {
  if (!player) {
    return <div className="border border-dashed border-gray-600 rounded p-1 text-center text-gray-500 text-xs">Empty Seat</div>;
  }

  return (
    <div className={`relative border ${isActive ? 'border-purple-500 shadow-lg' : 'border-gray-700'} rounded bg-gray-800 p-1 sm:p-2`}>
      <div className="flex justify-between items-center">
        <div className="text-xs font-medium truncate">{player.name}</div>
        <div className="text-yellow-500 text-xs font-bold">{player.chips}</div>
      </div>
      {player.currentBet > 0 && <div className="text-xs text-green-400">Bet: {player.currentBet}</div>}
      <div className="mt-1 flex justify-center gap-1">
        {player.holeCards.length > 0 ? (
          <>
            {isShowdown || reveal ? (
              <>
                <PlayingCard value={formatCard(player.holeCards[0]).value} suit={player.holeCards[0].suit} />
                <PlayingCard value={formatCard(player.holeCards[1]).value} suit={player.holeCards[1].suit} />
              </>
            ) : (
              <>
                <HiddenCard />
                <HiddenCard />
              </>
            )}
          </>
        ) : (
          <div className="text-xs text-gray-500 h-9 sm:h-12 flex items-center justify-center">No cards</div>
        )}
      </div>
      {player.isFolded && (
        <div className="absolute inset-0 bg-black/60 flex items-center justify-center rounded">
          <span className="text-red-500 font-bold text-xs">FOLDED</span>
        </div>
      )}
    </div>
  );
};

export const GameTable = () => {
  const [remaining, setRemaining] = useState<number>(0);
  const {
    gameState,
    performAction,
    players,
    tableSettings,
    createTable,
    joinTable,
    isHost,
    currentPlayerIndex,
    showdownData,
    nextHand,
    beginGame,
    isGameStarted,
    lastTxHash,
    turnDeadline
  } = useGame();
  const myNick = (localStorage.getItem('playerName') || '').trim();
  const { roomId } = useParams();
  const [isCreating, setIsCreating] = useState(false);
  // global countdown effect
  useEffect(() => {
    if (!turnDeadline) { setRemaining(0); return; }
    const tick = () => {
      const sec = Math.max(0, Math.floor((turnDeadline - Date.now()) / 1000));
      setRemaining(sec);
    };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [turnDeadline]);
  const [betAmount, setBetAmount] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (gameState) {
      setBetAmount(Math.max(gameState.currentBet, gameState.bigBlind));
    }
  }, [gameState]);

  useEffect(() => {
    if (errorMessage) {
      const timer = setTimeout(() => setErrorMessage(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [errorMessage]);

  // Auto-create table in this session if navigated from LandingPage
  useEffect(() => {
    if (tableSettings) return;
    try {
      const raw = sessionStorage.getItem('pendingCreate');
      if (!raw) return;
      const data = JSON.parse(raw);
      if (!data || data.roomId !== roomId) return;
      sessionStorage.removeItem('pendingCreate');
      setIsCreating(true);
      createTable(data.nickname, data.stack, data.sb, data.bb);
      setTimeout(() => setIsCreating(false), 800);
    } catch {}
  }, [roomId, tableSettings, createTable]);

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
    if (isHost) {
      return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 text-white gap-4">
          <h2 className="text-xl">Waiting for players… ({players.length}/2+ joined)</h2>
          {players.length >= 2 ? (
            <button onClick={beginGame} className="bg-purple-600 hover:bg-purple-700 text-white px-6 py-3 rounded-lg">Start Game</button>
          ) : (
            <div className="text-gray-400">Share this URL so others can join.</div>
          )}
        </div>
      );
    }
    return <div className="flex items-center justify-center min-h-screen bg-gray-900 text-white">Waiting for host…</div>;
  }

  const currentPlayer = currentPlayerIndex !== null && gameState && gameState.players[currentPlayerIndex] ? gameState.players[currentPlayerIndex] : null;
  const isShowdown = gameState?.stage === GameStage.Showdown;
  const mySeatName = ((typeof sessionStorage !== 'undefined' && sessionStorage.getItem('mySeatName')) || '').trim();
  const isMyTurn = !!(currentPlayer && mySeatName && currentPlayer.name === mySeatName);
  const minBet = gameState ? Math.max(gameState.currentBet, gameState.bigBlind) : 0;
  const callAmount = currentPlayer && gameState ? gameState.currentBet - currentPlayer.currentBet : 0;

  const handleRaise = () => {
    if (!currentPlayer || !gameState) return;

    if (betAmount < minBet) {
      setErrorMessage(`Minimum raise is ${minBet} chips`);
      return;
    }
    if (betAmount > currentPlayer.chips) {
      setErrorMessage(`You only have ${currentPlayer.chips} chips`);
      return;
    }
    performAction(PlayerAction.Raise, betAmount);
  };

  if (!gameState) {
    return <div className="flex items-center justify-center min-h-screen bg-gray-900 text-white">Loading…</div>;
  }

  const isPlayerTurn = (playerId: number) => currentPlayerIndex === playerId;

  return (
    <div className="p-2 sm:p-4 space-y-2 text-white bg-gray-900 min-h-screen flex flex-col">

      {/* Header */}
      <header className="flex justify-between items-center p-2 sm:p-4 bg-gray-900 border-b border-purple-800">
        <h1 className="text-xl sm:text-2xl font-bold text-purple-500">Monad Poker</h1>
        {turnDeadline && <span className={`ml-4 text-xs font-mono ${remaining<=5?'text-red-400':'text-yellow-300'}`}>⏱ {remaining}s</span>}
        {lastTxHash && (
          <div className="flex items-center gap-2 bg-gray-800 px-2 py-1 rounded">
            <span className="text-xs text-purple-300 truncate max-w-[120px]" title={lastTxHash}>{lastTxHash.slice(0, 10)}…</span>
            <button
              onClick={() => navigator.clipboard.writeText(lastTxHash)}
              className="bg-purple-600 hover:bg-purple-700 text-white text-[10px] px-2 py-0.5 rounded"
            >Copy</button>
          </div>
        )}
      </header>

      {/* Game Info */}
      <div className="flex justify-between items-center p-2 sm:p-4 bg-gray-800/50">
        <div>
          <div className="flex items-center gap-1">
            <span className="text-xs sm:text-sm">Dealer: </span>
            <span className="text-purple-400 font-semibold text-xs sm:text-sm">
              {gameState.players[gameState.dealerPosition]?.name || ''}
            </span>
          </div>
          <div className="text-xs text-gray-400">Stage: <span className="text-purple-300">{gameState.stage}</span></div>
          <div className="text-xs text-gray-400">Blinds: <span className="text-yellow-500">{gameState.smallBlind} / {gameState.bigBlind}</span></div>
        </div>
        <div className="text-right">
          <div className="text-xl sm:text-2xl font-bold text-green-500">{gameState.pot}</div>
          <div className="text-xs text-gray-400">pot total</div>
        </div>
      </div>

      {/* Poker Table */}
      <div className="flex-1 relative bg-gradient-to-b from-green-900 to-green-800 p-2 sm:p-4 flex flex-col justify-center">
        {/* Community Cards */}
        {gameState.communityCards.length > 0 && (
          <div className="flex justify-center gap-1 sm:gap-2 my-2">
            {gameState.communityCards.map((card, index) => (
              <PlayingCard key={index} value={formatCard(card).value} suit={card.suit} className="w-8 h-12 sm:w-10 sm:h-16" />
            ))}
          </div>
        )}

        {/* Player Seats - Dynamic Grid */}
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2 p-2">
          {gameState.players.map((player, index) => (
            <PlayerPosition
              key={player?.id || index}
              player={player}
              isActive={isPlayerTurn(index)}
              isShowdown={!!isShowdown}
              reveal={!!mySeatName && !!player && player.name === mySeatName}
            />
          ))}
        </div>
      </div>

      {/* Player Controls */}
      <div className="bg-gray-800 p-2 sm:p-4">
        {isShowdown ? (
          <div className="text-center py-4">
            <div className="text-purple-400 font-semibold">Showdown in progress...</div>
          </div>
        ) : isMyTurn ? (
          <>
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center mb-2">
              <div className="text-purple-400 font-semibold text-xs sm:text-sm mb-1 sm:mb-0">
                {currentPlayer.name}'s turn{' '}
                <span className="bg-yellow-500 text-black text-xs px-1 py-0.5 rounded-sm ml-1 sm:ml-2">Your turn</span>
              </div>
              <div className="text-gray-300 text-xs sm:text-sm">
                {callAmount > 0 ? `Call: ${callAmount} chips` : 'Check'}
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-1 sm:gap-2">
              {/* Mobile Buttons */}
              <div className="flex gap-1 sm:hidden w-full">
                <button className="bg-red-600 text-white px-2 py-1 rounded text-xs flex-1" onClick={() => performAction(PlayerAction.Fold)}>Fold</button>
                <button className="bg-blue-600 text-white px-2 py-1 rounded text-xs flex-1" onClick={() => performAction(callAmount > 0 ? PlayerAction.Call : PlayerAction.Check)}>
                  {callAmount > 0 ? `Call ${callAmount}` : 'Check'}
                </button>
              </div>
              <div className="flex gap-1 sm:hidden w-full mt-1">
                <button className="bg-gray-600 text-white px-2 py-1 rounded text-xs flex-1" onClick={handleRaise}>Raise {betAmount}</button>
                <button className="bg-purple-600 text-white px-2 py-1 rounded text-xs flex-1" onClick={() => performAction(PlayerAction.AllIn)}>All In ({currentPlayer.chips})</button>
              </div>
              <div className="flex items-center gap-1 sm:hidden my-1 w-full">
                <span className="text-xs w-8 text-right">{betAmount}</span>
                <input type="range" className="w-full h-4" min={minBet} max={currentPlayer.chips} step={gameState.bigBlind / 2} value={betAmount} onChange={e => setBetAmount(parseInt(e.target.value))} />
              </div>

              {/* Desktop Buttons */}
              <div className="hidden sm:flex sm:gap-2 sm:items-center w-full">
                <button className="bg-red-600 text-white px-4 py-2 rounded flex-1" onClick={() => performAction(PlayerAction.Fold)}>Fold</button>
                <button className="bg-blue-600 text-white px-4 py-2 rounded flex-1" onClick={() => performAction(callAmount > 0 ? PlayerAction.Call : PlayerAction.Check)}>
                  {callAmount > 0 ? `Call ${callAmount}` : 'Check'}
                </button>
                <div className="flex-1 flex items-center gap-2">
                  <span className="text-sm">{betAmount}</span>
                  <input type="range" className="w-full" min={minBet} max={currentPlayer.chips} step={gameState.bigBlind / 2} value={betAmount} onChange={e => setBetAmount(parseInt(e.target.value))} />
                </div>
                <button className="bg-gray-600 text-white px-4 py-2 rounded flex-1" onClick={handleRaise}>Raise {betAmount}</button>
                <button className="bg-purple-600 text-white px-4 py-2 rounded flex-1" onClick={() => performAction(PlayerAction.AllIn)}>All In ({currentPlayer.chips})</button>
              </div>
            </div>
          </>
        ) : (
          <div className="text-center py-2">Waiting for your turn...</div>
        )}
      </div>

      {/* Error Notification Popup */}
      {errorMessage && (
        <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50">
          <div className="bg-red-600 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2">
            <span className="text-sm font-medium">{errorMessage}</span>
            <button onClick={() => setErrorMessage(null)} className="text-white hover:text-gray-200 ml-2">✕</button>
          </div>
        </div>
      )}

      {/* Showdown Modal */}
      {showdownData && <ShowdownModal isOpen={!!showdownData} gameState={gameState} data={showdownData} onNextHand={nextHand} />}
    </div>
  );
};