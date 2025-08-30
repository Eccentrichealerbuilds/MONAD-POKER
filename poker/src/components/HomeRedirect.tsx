import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

// Simple component that immediately creates a new room id and redirects
export const HomeRedirect = () => {
  const navigate = useNavigate();
  useEffect(() => {
    const newId = crypto.randomUUID().slice(0, 6);
    navigate(`/game/${newId}`, { replace: true });
  }, [navigate]);

  return <div className="flex items-center justify-center h-screen text-xl">Creating table…</div>;
};
