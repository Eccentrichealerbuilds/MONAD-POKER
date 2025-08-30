import React from 'react';
import { Card as CardType, Suit, Rank } from '../types';
type CardProps = {
  card?: CardType;
  hidden?: boolean;
};
export const Card = ({
  card,
  hidden = false
}: CardProps) => {
  const getRankDisplay = (rank: Rank): string => {
    switch (rank) {
      case Rank.Jack:
        return 'J';
      case Rank.Queen:
        return 'Q';
      case Rank.King:
        return 'K';
      case Rank.Ace:
        return 'A';
      default:
        return rank.toString();
    }
  };
  const getSuitColor = (suit?: Suit): string => {
    if (!suit) return 'text-gray-800';
    switch (suit) {
      case Suit.Hearts:
      case Suit.Diamonds:
        return 'text-red-500';
      case Suit.Clubs:
      case Suit.Spades:
        return 'text-gray-800';
      default:
        return 'text-gray-800';
    }
  };
  if (!card || hidden) {
    return <div className="card w-10 h-14 bg-blue-800 rounded-md flex items-center justify-center border-2 border-blue-700 shadow-md">
        <div className="text-xl font-bold text-blue-300">?</div>
      </div>;
  }
  return <div className="card w-10 h-14 bg-white rounded-md flex flex-col items-center justify-center border border-gray-300 shadow-md">
      <div className={`text-sm font-bold ${getSuitColor(card.suit)}`}>
        {getRankDisplay(card.rank)}
      </div>
      <div className={`text-lg ${getSuitColor(card.suit)}`}>{card.suit}</div>
    </div>;
};