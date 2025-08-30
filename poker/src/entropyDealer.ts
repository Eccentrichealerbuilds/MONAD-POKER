import {
  createPublicClient,
  http,
  Address,
  Hex,
  parseEventLogs,
  decodeEventLog,
  getContract,
  PublicClient,
  encodeFunctionData,
} from "viem";
import { defineChain } from "viem";
import { dealerAbi } from "./dealerAbi";

// ---------------------- Chain definition ----------------------
export const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://testnet-rpc.monad.xyz"] },
    public: { http: ["https://testnet-rpc.monad.xyz"] },
  },
});

// ---------------------- Contract address ----------------------
export const DEALER_ADDRESS = "0xa9aE08A570798fB7668A571022c7dFF2C160E8E4" as Address;

// ---------------------- Helpers ----------------------

export function getPublicClient(): PublicClient {
  return createPublicClient({ chain: monadTestnet, transport: http(monadTestnet.rpcUrls.default.http[0]) });
}

export function getDealerContract(client: PublicClient) {
  return getContract({ address: DEALER_ADDRESS, abi: dealerAbi, client });
}

export async function fetchShuffleFee(): Promise<bigint> {
  const publicClient = getPublicClient();
  const contract = getDealerContract(publicClient);
  return contract.read.getShuffleFee();
}

// Encode contract call data for Privy sendTransaction
export function encodeRequestShuffleData(): Hex {
  return encodeFunctionData({
    abi: dealerAbi,
    functionName: 'requestShuffle',
    args: []
  });
}

export async function waitForDeck(sequence: bigint, onDeck: (packedDeck: string) => void): Promise<() => void> {
  const publicClient = getPublicClient();
  const contract = getDealerContract(publicClient);
  
  // Start watching from a few blocks back to catch recent events
  const currentBlock = await publicClient.getBlockNumber();
  let fromBlock = currentBlock - 50n; // Look back more blocks since entropy callback takes time
  if (fromBlock < 0n) fromBlock = 0n;
  
  console.log('Watching for Shuffled event from block:', fromBlock.toString(), 'current:', currentBlock.toString());
  console.log('Looking for sequence number:', sequence.toString());
  
  // First check if the event already exists in recent blocks
  try {
    const logs = await publicClient.getLogs({
      address: DEALER_ADDRESS,
      event: {
        type: 'event',
        name: 'Shuffled',
        inputs: [
          { name: 'sequenceNumber', type: 'uint64', indexed: false },
          { name: 'packedDeck', type: 'bytes', indexed: false }
        ]
      },
      fromBlock,
      toBlock: 'latest'
    });
    
    console.log('Found', logs.length, 'existing Shuffled events');
    for (const log of logs) {
      const decoded = decodeEventLog({
        abi: [{
          type: 'event',
          name: 'Shuffled',
          inputs: [
            { name: 'sequenceNumber', type: 'uint64', indexed: false },
            { name: 'packedDeck', type: 'bytes', indexed: false }
          ]
        }],
        data: log.data,
        topics: log.topics
      });
      
      const eventSequence = decoded.args.sequenceNumber ? BigInt(decoded.args.sequenceNumber) : null;
      console.log('Existing event sequence:', eventSequence?.toString());
      if (eventSequence && eventSequence === sequence) {
        console.log('Found existing shuffle event!');
        onDeck(decoded.args.packedDeck as string);
        return () => {};
      }
    }
  } catch (error) {
    console.log('Error checking existing events:', error);
  }
  
  // If not found, watch for new events
  let unwatch: (() => void) | undefined;
  unwatch = contract.watchEvent.Shuffled({
    fromBlock: currentBlock,
    onLogs: (logs: any[]) => {
      console.log('Received new Shuffled event logs:', logs.length);
      for (const log of logs) {
        const newEventSequence = log.args.sequenceNumber ? BigInt(log.args.sequenceNumber) : null;
        console.log('New event sequence:', newEventSequence?.toString(), 'looking for:', sequence.toString());
        if (newEventSequence && newEventSequence === sequence) {
          console.log('Found matching new shuffle event!');
          try { unwatch && unwatch(); } catch {}
          onDeck(log.args.packedDeck as string);
        }
      }
    },
  });
  return unwatch ?? (() => {});
}

// Parse sequence number from transaction receipt
export function parseSequenceFromReceipt(receipt: any): bigint {
  const parsed = parseEventLogs({ abi: dealerAbi, logs: receipt.logs });
  const evt = parsed.find((l) => l.eventName === "ShuffleRequested");
  if (!evt) throw new Error("ShuffleRequested event not found");
  if (!evt.args.sequenceNumber) throw new Error("Sequence number not found in ShuffleRequested event");
  return BigInt(evt.args.sequenceNumber);
}
