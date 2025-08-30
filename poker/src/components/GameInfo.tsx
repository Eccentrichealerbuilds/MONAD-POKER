import React from 'react';
import { useGame } from '../context/GameContext';
export const GameInfo = () => {
  const {
    gameState
  } = useGame();
  if (!gameState) {
    return <div className="bg-gray-800 p-4 rounded-xl mb-8">
        Loading game info...
      </div>;
  }
  // Find the dealer player
  const dealer = gameState.players.find(p => p.id === gameState.dealerPosition);
  return <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 bg-gray-800 p-4 rounded-xl">
      <div>
        <div className="flex items-center space-x-4">
          <h2 className="text-xl font-bold">
            Dealer:{' '}
            <span className="text-purple-400">{dealer?.name || 'Unknown'}</span>
          </h2>
          <span className="bg-gray-700 px-3 py-1 rounded-full text-sm">
            NLH
          </span>
          <span className="text-gray-300">
            {gameState.smallBlind} / {gameState.bigBlind}
          </span>
        </div>
        <div className="flex space-x-2 mt-2">
          <div className="text-gray-400 text-sm">
            Stage: <span className="text-yellow-400">{gameState.stage}</span>
          </div>
        </div>
      </div>
      <div className="mt-4 md:mt-0 text-center md:text-right">
        <div className="text-3xl font-bold text-green-400">{gameState.pot}</div>
        <div className="text-gray-400">pot total</div>
      </div>
    </div>;
};