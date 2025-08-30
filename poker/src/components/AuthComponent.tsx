import { useEffect, useState } from 'react';
import { usePrivy, CrossAppAccountWithMetadata } from '@privy-io/react-auth';
import { useMonadGamesUser } from '../hooks/useMonadGamesUser';

function AuthNotConfigured() {
  return (
    <div className="text-yellow-400 text-sm">Authentication not configured</div>
  );
}

function PrivyAuth({ onAddressChange }: { onAddressChange: (address: string) => void }) {
  const { authenticated, user, ready, logout, login } = usePrivy();
  const [accountAddress, setAccountAddress] = useState<string>('');
  const [message, setMessage] = useState<string>('');

  const { user: monadUser, hasUsername, isLoading: isLoadingUser } = useMonadGamesUser(accountAddress);

  useEffect(() => {
    if (authenticated && user && ready) {
      if (user.linkedAccounts.length > 0) {
        const crossAppAccount: CrossAppAccountWithMetadata | undefined = user.linkedAccounts
          .filter(
            (account: any) => account.type === 'cross_app' && account.providerApp?.id === 'cmd8euall0037le0my79qpz42'
          )[0] as CrossAppAccountWithMetadata | undefined;
        if (crossAppAccount && crossAppAccount.embeddedWallets.length > 0) {
          const address = crossAppAccount.embeddedWallets[0].address;
          setAccountAddress(address);
          onAddressChange(address);
        }
      } else {
        setMessage('You need to link your Monad Games ID account to continue.');
      }
    } else {
      setAccountAddress('');
      onAddressChange('');
    }
  }, [authenticated, user, ready, onAddressChange]);

  if (!ready) {
    return <div className="text-white text-sm">Loading...</div>;
  }

  if (!authenticated) {
    return (
      <button onClick={login} className="bg-blue-500 text-white px-3 py-1 rounded text-sm hover:bg-blue-600">
        Sign in with Monad Games ID
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      {accountAddress ? (
        <>
          {hasUsername && monadUser ? (
            <span className="text-green-400">Monad Games ID: {monadUser.username}</span>
          ) : isLoadingUser ? (
            <span className="text-gray-300">Loading username...</span>
          ) : (
            <a
              href="https://monad-games-id-site.vercel.app"
              target="_blank"
              rel="noopener noreferrer"
              className="bg-yellow-600 text-white px-2 py-1 rounded text-xs hover:bg-yellow-700"
            >
              Register Username
            </a>
          )}
        </>
      ) : message ? (
        <span className="text-red-400 text-xs">{message}</span>
      ) : (
        <span className="text-yellow-400 text-xs">Checking...</span>
      )}

      <button onClick={logout} className="bg-red-500 text-white px-2 py-1 rounded text-xs hover:bg-red-600">
        Logout
      </button>
    </div>
  );
}

export default function AuthComponent({ onAddressChange }: { onAddressChange: (address: string) => void }) {
  const privyAppId = (import.meta as any).env?.VITE_PRIVY_APP_ID as string | undefined;
  if (!privyAppId) {
    return <AuthNotConfigured />;
  }
  return <PrivyAuth onAddressChange={onAddressChange} />;
}
