import { FC, useState, useEffect } from 'react';
import { useWallets, usePrivy, type ConnectedWallet, CrossAppAccountWithMetadata } from '@privy-io/react-auth';
import { 
  createWalletClient, 
  custom, 
  formatEther, 
  parseEther,
  type Address 
} from 'viem';
import { monadTestnet, getPublicClient } from '../entropyDealer';

interface WalletInfoState {
  embeddedBalance: string;
  monadBalance: string;
  sendAmount: string;
  recipientAddress: string;
  isSending: boolean;
  showExportModal: boolean;
  isExporting: boolean;
  error: string | null;
  hasExportedKey: boolean;
}

export const WalletInfo: FC = () => {
  const { wallets } = useWallets();
  const { exportWallet, user } = usePrivy();
  const [state, setState] = useState<WalletInfoState>({
    embeddedBalance: '0',
    monadBalance: '0',
    sendAmount: '',
    recipientAddress: '',
    isSending: false,
    showExportModal: false,
    isExporting: false,
    error: null,
    hasExportedKey: false
  });

  // Get Embedded (Privy) wallet
  const getEmbeddedWallet = (): ConnectedWallet | undefined => {
    return wallets?.find(w => w.walletClientType === 'privy') as ConnectedWallet | undefined;
  };
  // Get Monad Games ID (cross-app) wallet address
  const getMonadGamesIdAddress = (): string | undefined => {
    if (!user?.linkedAccounts?.length) return undefined;
    const crossAppAccount: CrossAppAccountWithMetadata | undefined = user.linkedAccounts
      .filter((account: any) => account.type === 'cross_app' && account.providerApp?.id === 'cmd8euall0037le0my79qpz42')[0] as CrossAppAccountWithMetadata | undefined;
    return crossAppAccount?.embeddedWallets?.[0]?.address;
  };

  const embeddedWallet = getEmbeddedWallet();
  const embeddedAddress = embeddedWallet?.address as Address | undefined;
  const monadAddress = getMonadGamesIdAddress();
  
  // Setup viem clients
  const setupClients = async () => {
    if (!embeddedWallet) return null;
    const provider = await embeddedWallet.getEthereumProvider();
    return {
      walletClient: createWalletClient({
        chain: monadTestnet,
        transport: custom(provider)
      })
    };
  };

  // Fetch balances for both wallets
  const fetchBalance = async () => {
    try {
      const publicClient = getPublicClient();
      if (embeddedAddress) {
        const bal = await publicClient.getBalance({ address: embeddedAddress });
        setState(prev => ({ ...prev, embeddedBalance: formatEther(bal), error: null }));
      }
      if (monadAddress) {
        const bal2 = await publicClient.getBalance({ address: monadAddress as Address });
        setState(prev => ({ ...prev, monadBalance: formatEther(bal2), error: null }));
      }
    } catch (error) {
      setState(prev => ({ ...prev, error: 'Failed to fetch balance' }));
    }
  };

  // Copy address
  const copyAddress = async (addr: string) => {
    if (!addr) return;
    try {
      await navigator.clipboard.writeText(addr);
      setState(prev => ({ ...prev, error: null }));
    } catch (error) {
      setState(prev => ({ ...prev, error: 'Failed to copy address' }));
    }
  };

  // Send MON
  const sendMON = async () => {
    if (!embeddedAddress || !state.sendAmount || !state.recipientAddress) return;
    setState(prev => ({ ...prev, isSending: true, error: null }));
    
    try {
      const clients = await setupClients();
      if (!clients) return;
      const publicClient = getPublicClient();

      const hash = await clients.walletClient.sendTransaction({
        account: embeddedAddress as Address,
        to: state.recipientAddress as Address,
        value: parseEther(state.sendAmount),
      });

      // Wait for transaction
      await publicClient.waitForTransactionReceipt({ hash });
      
      // Clear form and refresh balance
      setState(prev => ({
        ...prev,
        sendAmount: '',
        recipientAddress: '',
        isSending: false,
        error: null
      }));
      fetchBalance();
    } catch (error) {
      console.error('Transaction failed:', error);
      setState(prev => ({
        ...prev,
        isSending: false,
        error: error instanceof Error ? error.message : 'Transaction failed'
      }));
    }
  };

  // Export private key of the Embedded wallet using Privy's built-in method
  const exportPrivateKey = async () => {
    if (!embeddedWallet || !embeddedAddress) return;
    
    setState(prev => ({
      ...prev,
      isExporting: true,
      error: null
    }));

    try {
      // Use Privy's exportWallet method with UI handling
      await exportWallet({ address: embeddedAddress });

      setState(prev => ({
        ...prev,
        hasExportedKey: true,
        isExporting: false,
        showExportModal: false,
        error: null
      }));

    } catch (error) {
      console.error('Export failed:', error);
      setState(prev => ({
        ...prev,
        isExporting: false,
        error: error instanceof Error ? error.message : 'Failed to export wallet'
      }));
    }
  };

  // Fetch balance on mount
  useEffect(() => {
    fetchBalance();
  }, []);

  return (
    <div className="bg-gray-800 rounded-lg p-6 mt-4 w-full max-w-md">
      <div className="space-y-6">
        {/* Embedded Wallet (Signing) */}
        {embeddedAddress && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-400">Embedded Wallet (Signing):</span>
              <div className="flex items-center gap-2">
                <code className="text-sm">{embeddedAddress.slice(0, 6)}...{embeddedAddress.slice(-4)}</code>
                <button onClick={() => copyAddress(embeddedAddress)} className="text-purple-400 hover:text-purple-300 text-sm">Copy</button>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-400">Balance:</span>
              <div className="flex items-center gap-2">
                <span>{state.embeddedBalance} MON</span>
                <button onClick={fetchBalance} className="text-purple-400 hover:text-purple-300 text-sm">Refresh</button>
              </div>
            </div>
            {/* Send MON from Embedded Wallet */}
            <div className="space-y-2">
              <input
                type="text"
                placeholder="Recipient Address (0x...)"
                value={state.recipientAddress}
                onChange={e => setState(prev => ({ ...prev, recipientAddress: e.target.value }))}
                className="w-full px-3 py-2 bg-gray-700 rounded text-sm"
              />
              <div className="flex gap-2">
                <input
                  type="number"
                  placeholder="Amount (MON)"
                  value={state.sendAmount}
                  onChange={e => setState(prev => ({ ...prev, sendAmount: e.target.value }))}
                  className="flex-1 px-3 py-2 bg-gray-700 rounded text-sm"
                />
                <button
                  onClick={sendMON}
                  disabled={state.isSending || !state.sendAmount || !state.recipientAddress}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded text-sm disabled:opacity-50"
                >
                  {state.isSending ? 'Sending...' : 'Send'}
                </button>
              </div>
            </div>
            {/* Export Key for Embedded Wallet */}
            <button
              onClick={() => setState(prev => ({ ...prev, showExportModal: true }))}
              className="w-full px-4 py-2 border border-purple-500 text-purple-400 hover:bg-purple-500/10 rounded text-sm"
            >
              Export Private Key
            </button>
          </div>
        )}

        {/* Divider */}
        <div className="border-t border-gray-700" />

        {/* Game ID Wallet (On-chain submitter) */}
        {monadAddress && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-400">Game ID Wallet (On-chain submitter):</span>
              <div className="flex items-center gap-2">
                <code className="text-sm">{monadAddress.slice(0, 6)}...{monadAddress.slice(-4)}</code>
                <button onClick={() => copyAddress(monadAddress)} className="text-purple-400 hover:text-purple-300 text-sm">Copy</button>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-400">Balance:</span>
              <div className="flex items-center gap-2">
                <span>{state.monadBalance} MON</span>
                <button onClick={fetchBalance} className="text-purple-400 hover:text-purple-300 text-sm">Refresh</button>
              </div>
            </div>
            <p className="text-xs text-gray-400">Used by the backend to record game activity on-chain.</p>
          </div>
        )}
      </div>

      {/* Export Warning Modal */}
      {state.showExportModal && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center p-4">
          <div className="bg-gray-800 rounded-lg p-6 max-w-md w-full">
            <h3 className="text-lg font-bold text-red-500 mb-4">⚠️ Security Warning</h3>
            <p className="text-sm text-gray-300 mb-6">
              Your private key is a secret that gives complete control over your wallet and funds.
              Never share it with anyone or enter it into untrusted websites.
            </p>
            {state.error && (
              <p className="text-sm text-red-500 mb-4">{state.error}</p>
            )}
            <div className="flex gap-4">
              <button
                onClick={() => setState(prev => ({ ...prev, showExportModal: false }))}
                className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm"
              >
                Cancel
              </button>
              <button
                onClick={exportPrivateKey}
                disabled={state.isExporting}
                className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 rounded text-sm disabled:opacity-50"
              >
                {state.isExporting ? 'Exporting...' : 'I Understand, Export'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
