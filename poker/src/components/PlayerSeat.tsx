import React from 'react';
import { Card } from './Card';
type PlayerSeatProps = {
  position: number;
  player?: {
    id: number;
    name: string;
    chips: number;
    isActive?: boolean;
    isTurn?: boolean;
    isFolded?: boolean;
    isAllIn?: boolean;
    currentBet?: number;
    cards?: Array<{
      rank: number;
      suit: string;
      hidden?: boolean;
    }>;
    isDealer?: boolean;
    isSmallBlind?: boolean;
    isBigBlind?: boolean;
    handClue?: string;
  };
};
export const PlayerSeat = ({
  position,
  player
}: PlayerSeatProps) => {
  // Calculate position class based on seat number
  const getPositionClass = () => {
    switch (position) {
      case 1:
        return 'absolute bottom-0 left-1/4 transform -translate-x-1/2';
      case 2:
        return 'absolute bottom-0 right-1/4 transform translate-x-1/2';
      case 3:
        return 'absolute bottom-1/4 right-0 transform translate-x-1/2';
      case 4:
        return 'absolute top-1/2 right-0 transform translate-x-1/2 -translate-y-1/2';
      case 5:
        return 'absolute top-1/4 right-0 transform translate-x-1/2';
      case 6:
        return 'absolute top-0 right-1/4 transform translate-x-1/2';
      case 7:
        return 'absolute top-0 left-1/4 transform -translate-x-1/2';
      case 8:
        return 'absolute top-1/4 left-0 transform -translate-x-1/2';
      case 9:
        return 'absolute top-1/2 left-0 transform -translate-x-1/2 -translate-y-1/2';
      case 10:
        return 'absolute bottom-1/4 left-0 transform -translate-x-1/2';
      default:
        return '';
    }
  };
  return <div className={`player-seat ${getPositionClass()}`}>
      {player ? <div className={`bg-gray-800 p-3 rounded-lg text-center w-40 ${player.isTurn ? 'ring-2 ring-yellow-400' : ''} ${player.isFolded ? 'opacity-50' : ''}`}>
          <div className="text-purple-400 font-bold text-sm truncate mb-1">
            {player.name}
            {player.isDealer && <span className="ml-1 text-white">D</span>}
            {player.isSmallBlind && <span className="ml-1 text-blue-300">SB</span>}
            {player.isBigBlind && <span className="ml-1 text-blue-400">BB</span>}
          </div>
          <div className="text-yellow-400 font-bold text-sm mb-2">
            {player.chips}
          </div>
          {player.currentBet && player.currentBet > 0 && <div className="text-green-400 text-xs mb-1">
              Bet: {player.currentBet}
            </div>}
          {player.isAllIn && <div className="text-red-400 text-xs mb-1">ALL IN</div>}
          {player.isFolded && <div className="text-gray-400 text-xs mb-1">FOLDED</div>}
          {player.cards && <div className="flex justify-center space-x-1 -mb-2 transform scale-75">
              {player.cards.map((card, idx) => <Card key={idx} card={card.hidden ? undefined : {
          rank: card.rank,
          suit: card.suit as any
        }} hidden={card.hidden} />)}
            </div>}
          {/* Hand clue */}
          {player.handClue && <div className="text-green-300 text-xs mt-2">{player.handClue}</div>}
        </div> : <div className="bg-gray-700 bg-opacity-50 p-5 rounded-lg text-center w-40 border-2 border-dashed border-gray-600">
          <div className="text-gray-400 text-sm">Seat {position}</div>
        </div>}
    </div>;
};