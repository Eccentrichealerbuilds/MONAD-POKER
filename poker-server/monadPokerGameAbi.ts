// ABI for MonadPokerGame contract (submit per-hand results)
export const MONAD_POKER_GAME_ABI = [
  {
    inputs: [
      { internalType: "address[]", name: "players", type: "address[]" },
      { internalType: "bool[]", name: "winners", type: "bool[]" },
      { internalType: "bytes32", name: "handId", type: "bytes32" },
      { internalType: "bytes32", name: "tableId", type: "bytes32" },
      { internalType: "bytes32", name: "deckHash", type: "bytes32" },
      { internalType: "bytes32", name: "requestId", type: "bytes32" }
    ],
    name: "submitHandResult",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  }
] as const;
