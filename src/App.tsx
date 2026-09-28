import { useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { getToken, setToken, UNAUTHORIZED_EVENT } from './api/client';
import type { Session } from './api/types';
import { LoginScreen } from './components/LoginScreen';
import { MainShell } from './components/MainShell';
import { ToastProvider } from './components/Toasts';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, staleTime: 5_000, refetchOnWindowFocus: true },
  },
});

function Root() {
  const [authorized, setAuthorized] = useState<boolean>(() => getToken() !== null);
  const qc = useQueryClient();

  // Любой 401 от API = сессия мертва (блокировка, другая вкладка) → экран входа
  useEffect(() => {
    const onUnauthorized = () => {
      setAuthorized(false);
      qc.clear();
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [qc]);

  const handleSession = (s: Session) => {
    setToken(s.token);
    qc.clear();
    setAuthorized(true);
  };

  const handleLocked = () => {
    setAuthorized(false);
    qc.clear();
  };

  return authorized ? (
    <MainShell onLocked={handleLocked} />
  ) : (
    <LoginScreen onSession={handleSession} />
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <Root />
      </ToastProvider>
    </QueryClientProvider>
  );
}
