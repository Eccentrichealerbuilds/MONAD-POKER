import React from 'react';
import { Card } from './Card';
import { GameState } from '../types';
type ShowdownData = {
  winners: {
    id: number;
    name: string;
  }[];
  evaluations: Record<number, {
    description: string;
    cards: {
      rank: number;
      suit: string;
    }[];
  }>;
};
type Props = {
  isOpen: boolean;
  gameState: GameState;
  data: ShowdownData;
  onNextHand: () => void;
};
export const ShowdownModal: React.FC<Props> = ({
  isOpen,
  gameState,
  data,
  onNextHand
}) => {
  if (!isOpen) return null;
  // Helper to check winner
  const multipleWinners = data.winners.length > 1;
  const isWinner = (pid: number) => data.winners.some(w => w.id === pid);
  return <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 rounded-lg w-full max-w-2xl mx-auto p-4 sm:p-6 shadow-lg overflow-y-auto max-h-[90vh]">
        <h2 className="text-xl sm:text-2xl font-bold text-center text-yellow-400 mb-4">
          {multipleWinners ? 'Draw - Split Pot' : 'Showdown'}
        </h2>
        <div className="text-center text-gray-300 mb-1 text-sm sm:text-base">
          Community Cards
        </div>
        <div className="flex justify-center space-x-1 sm:space-x-2 mb-4 flex-wrap">
          {gameState.communityCards.map((c, idx) => <Card key={idx} card={c} />)}
        </div>
        <div className="space-y-4">
          {gameState.players.map(player => {
            if (player.isFolded) {
              return (
                <div key={player.id} className="p-3 sm:p-4 rounded-lg bg-gray-800 opacity-50">
                  <div className="flex justify-between items-center">
                    <span className="text-gray-400 font-bold text-sm sm:text-base">{player.name}</span>
                    <span className="text-red-500 font-semibold text-sm sm:text-base">Folded</span>
                  </div>
                </div>
              );
            }

            const evalRes = data.evaluations[player.id];
            return (
              <div key={player.id} className={`p-3 sm:p-4 rounded-lg ${isWinner(player.id) ? 'bg-green-800' : 'bg-gray-800'}`}>
                <div className="flex justify-between items-center mb-2">
                  <span className="text-purple-400 font-bold text-sm sm:text-base">
                    {player.name}
                  </span>
                  {isWinner(player.id) && <span className="text-green-400 font-bold text-sm sm:text-base">
                      {multipleWinners ? 'Split' : 'Winner'}
                    </span>}
                </div>
                <div className="flex flex-wrap gap-1 sm:gap-2 mb-2 justify-center sm:justify-start">
                  {player.holeCards.map((c, idx) => <Card key={idx} card={c} />)}
                  <span className="text-gray-400 font-bold self-center mx-1">
                    +
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {gameState.communityCards.map((c, idx) => <Card key={`comm-${idx}`} card={c} />)}
                  </div>
                </div>
                {evalRes && <div className="text-gray-300 text-xs sm:text-sm text-center sm:text-left">
                    Best Hand: {evalRes.description}
                  </div>}
              </div>
            );
          })}
        </div>
        <button onClick={onNextHand} className="mt-4 sm:mt-6 w-full bg-purple-600 hover:bg-purple-700 text-white py-2 rounded-lg font-bold">
          Deal Next Hand
        </button>
      </div>
    </div>;
};