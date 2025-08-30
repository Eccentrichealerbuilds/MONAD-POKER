import { Buffer } from 'buffer';
// Ensure Buffer is available globally for libraries that expect Node's Buffer
if (!(globalThis as any).Buffer) {
  (globalThis as any).Buffer = Buffer;
}
import './index.css';
import { createRoot } from 'react-dom/client';
import { PrivyProvider } from '@privy-io/react-auth';
import { App } from "./App";
import { monadTestnet } from './entropyDealer';

// Privy App ID should be set in poker/.env as VITE_PRIVY_APP_ID
const PRIVY_APP_ID = ((import.meta as any).env?.VITE_PRIVY_APP_ID || '') as string;

const container = document.getElementById('root');
if (container) {
  if (!PRIVY_APP_ID) {
    console.warn('[Privy] VITE_PRIVY_APP_ID is missing in poker/.env. Authentication will not work.');
  }
  const root = createRoot(container);
  root.render(
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        // Prioritize Monad Games Cross App ID in the login sheet
        // Ensure this integration is enabled in your Privy dashboard
        // (Global Wallet > Integrations > Monad Games ID)
        loginMethodsAndOrder: {
          primary: ["privy:cmd8euall0037le0my79qpz42"],
        },
        embeddedWallets: {
          createOnLogin: 'users-without-wallets', // Auto-create wallet on email login
          showWalletUIs: false, // Use custom UI instead of Privy's default
        },
        defaultChain: monadTestnet,
        supportedChains: [monadTestnet],
        appearance: {
          theme: 'dark',
          accentColor: '#7C3AED', // Purple color matching your UI
          showWalletLoginFirst: false, // Prioritize email login
        },
      }}
    >
      <App />
    </PrivyProvider>
  );
}