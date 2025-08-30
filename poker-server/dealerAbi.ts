// ABI for PokerEntropyDealer contract
export const dealerAbi = [
  {
    "inputs": [],
    "name": "getShuffleFee",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "requestShuffle",
    "outputs": [
      {
        "internalType": "uint64",
        "name": "seq",
        "type": "uint64"
      }
    ],
    "stateMutability": "payable",
    "type": "function"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": false,
        "internalType": "uint64",
        "name": "sequenceNumber",
        "type": "uint64"
      }
    ],
    "name": "ShuffleRequested",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": false,
        "internalType": "uint64",
        "name": "sequenceNumber",
        "type": "uint64"
      },
      {
        "indexed": false,
        "internalType": "bytes",
        "name": "packedDeck",
        "type": "bytes"
      }
    ],
    "name": "Shuffled",
    "type": "event"
  }
] as const;
