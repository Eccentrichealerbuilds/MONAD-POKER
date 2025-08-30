import React, { useEffect, useState } from 'react';
import { GameTable } from './GameTable';
import { GamePage } from './GamePage';
import { MobileWarning } from './MobileWarning';
export const ResponsiveGameLayout = () => {
  const [isMobile, setIsMobile] = useState(false);
  const [showWarning, setShowWarning] = useState(false);
  const [userChoice, setUserChoice] = useState<'mobile' | 'desktop' | null>(null);
  // Detect screen size on mount and when window resizes
  useEffect(() => {
    const checkScreenSize = () => {
      const mobile = window.innerWidth < 1024;
      setIsMobile(mobile);
      // Show warning on mobile if user hasn't made a choice yet
      if (mobile && userChoice === null) {
        setShowWarning(true);
      }
    };
    // Run initially
    checkScreenSize();
    // Add resize listener
    window.addEventListener('resize', checkScreenSize);
    return () => window.removeEventListener('resize', checkScreenSize);
  }, [userChoice]);
  // Handle user's choice to continue with desktop version on mobile
  const handleContinueWithDesktop = () => {
    setShowWarning(false);
    setUserChoice('desktop');
  };
  // Determine which layout to show based on screen size and user preference
  const getLayout = () => {
    // If on mobile and user hasn't explicitly chosen desktop, show mobile version
    if (isMobile && userChoice !== 'desktop') {
      return <GameTable />;
    } else {
      // Otherwise show desktop version
      return <GamePage />;
    }
  };
  return <>
      <MobileWarning isVisible={showWarning} onContinue={handleContinueWithDesktop} />
      {getLayout()}
    </>;
};