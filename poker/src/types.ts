/*
  Pure TypeScript types and enums shared between the game engine and the React UI.
  No Node/CLI dependencies.
*/
export enum Suit {
  Hearts = '♥',
  Diamonds = '♦',
  Clubs = '♣',
  Spades = '♠',
}
export enum Rank {
  Two = 2,
  Three = 3,
  Four = 4,
  Five = 5,
  Six = 6,
  Seven = 7,
  Eight = 8,
  Nine = 9,
  Ten = 10,
  Jack = 11,
  Queen = 12,
  King = 13,
  Ace = 14,
}
export enum HandRank {
  HighCard = 1,
  OnePair,
  TwoPair,
  ThreeOfAKind,
  Straight,
  Flush,
  FullHouse,
  FourOfAKind,
  StraightFlush,
  RoyalFlush,
}
export enum GameStage {
  PreFlop = 'Pre-Flop',
  Flop = 'Flop',
  Turn = 'Turn',
  River = 'River',
  Showdown = 'Showdown',
}
export enum PlayerAction {
  Fold = 'fold',
  Check = 'check',
  Call = 'call',
  Raise = 'raise',
  AllIn = 'allin',
}
export interface Card {
  rank: Rank;
  suit: Suit;
}
export interface HandEvaluation {
  rank: HandRank;
  value: number; // used for comparing hands
  description: string;
  cards: Card[]; // best 5 cards making the hand
}
export interface Player {
  id: number;
  name: string;
  chips: number;
  holeCards: Card[];
  isActive: boolean;
  isFolded: boolean;
  isAllIn: boolean;
  currentBet: number;
  totalBetInRound: number;
  isAI: boolean;
}
export interface GameState {
  players: Player[];
  deck: Card[];
  communityCards: Card[];
  pot: number;
  currentBet: number;
  stage: GameStage;
  dealerPosition: number;
  smallBlindPosition: number;
  bigBlindPosition: number;
  currentPlayerIndex: number;
  lastToActIndex: number;
  /** minimum amount required to raise (size of previous raise or big blind if none) */
  lastRaiseAmount: number;
  smallBlind: number;
  bigBlind: number;
  sidePots: {
    amount: number;
    eligiblePlayers: number[];
  }[];
  /** number of player actions in the current betting round */
  bettingActions: number;
  /** gameplay log lines (chronological) */
  logs: string[];
}