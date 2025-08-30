import { Card } from './Card';
import { PlayerSeat } from './PlayerSeat';
import { useGame } from '../context/GameContext';
import { GameStage } from '../types';
export const PokerTable = () => {
  const {
    gameState,
    currentPlayerIndex,
    engine
  } = useGame();
  const mySeatName = ((typeof sessionStorage !== 'undefined' && sessionStorage.getItem('mySeatName')) || '').trim();
  if (!gameState) {
    return <div className="text-center py-10">Loading game...</div>;
  }
  const getStageDisplay = (stage: GameStage): string => {
    return stage.toString();
  };
  // Set up player positions around the table
  const getPlayersForSeats = () => {
    const result = Array(10).fill(null);
    gameState.players.forEach((player, idx) => {
      // Map player index to seat position (1-10)
      // For simplicity, we'll put them in order around the table
      const seatPosition = idx + 1;
      if (seatPosition <= 10) {
        // Determine if hand clue should be shown
        let handClue: string | undefined;
        if (engine && gameState.stage !== GameStage.PreFlop) {
          const evalResult = engine.getHandEvaluation(idx);
          if (evalResult) {
            // Show to everyone at showdown
            if (gameState.stage === GameStage.Showdown) {
              handClue = evalResult.description;
            }
          }
        }
        result[seatPosition - 1] = {
          ...player,
          isTurn: idx === currentPlayerIndex,
          // Convert engine cards to UI format
          cards: player.holeCards.map(card => ({
            rank: card.rank,
            suit: card.suit,
            // Hide cards of players other than me unless at showdown
            hidden: gameState.stage !== GameStage.Showdown && player.name !== mySeatName
          })),
          handClue,
          isDealer: gameState.dealerPosition === player.id,
          isSmallBlind: gameState.smallBlindPosition === player.id,
          isBigBlind: gameState.bigBlindPosition === player.id
        };
      }
    });
    return result;
  };
  const players = getPlayersForSeats();
  return <div className="flex justify-center mb-10">
      <div className="poker-table relative w-full max-w-4xl h-96 bg-green-800 rounded-full border-8 border-brown-800 flex items-center justify-center">
        {/* Community Cards */}
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 flex space-x-2 z-20">
          {gameState.communityCards.map((card, index) => <Card key={index} card={card} />)}
        </div>
        {/* Pot */}
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 mt-12 z-20">
          <div className="chip bg-yellow-500 w-10 h-10 rounded-full flex items-center justify-center text-black font-bold shadow-lg text-sm">
            {gameState.pot}
          </div>
        </div>
        {/* Game Status */}
        <div className="absolute top-1/3 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-black bg-opacity-70 px-3 py-1 rounded-full text-sm z-20">
          <span className="font-bold text-purple-400">
            No Limit Texas Hold'em
          </span>{' '}
          <span className="text-yellow-400">
            {getStageDisplay(gameState.stage)}
          </span>
        </div>
        {/* Player Seats */}
        {players.map((player, idx) => <PlayerSeat key={idx} position={idx + 1} player={player ? {
        id: player.id,
        name: player.name,
        chips: player.chips,
        isActive: player.isActive,
        isTurn: player.isTurn,
        isFolded: player.isFolded,
        isAllIn: player.isAllIn,
        currentBet: player.currentBet,
        cards: player.cards,
        isDealer: player.isDealer,
        isSmallBlind: player.isSmallBlind,
        isBigBlind: player.isBigBlind,
        handClue: player.handClue
      } : undefined} />)}
      </div>
    </div>;
};