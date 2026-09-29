import { useCallback, useEffect, useState } from 'react';
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

  // Выход из сейфа любым путём: токен и кэш расшифрованных данных стираются
  const signOut = useCallback(() => {
    setToken(null);
    qc.clear();
    setAuthorized(false);
  }, [qc]);

  // Любой 401 от API = сессия мертва (блокировка, автоблокировка, другая вкладка)
  useEffect(() => {
    window.addEventListener(UNAUTHORIZED_EVENT, signOut);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, signOut);
  }, [signOut]);

  const handleSession = (s: Session) => {
    setToken(s.token);
    qc.clear();
    setAuthorized(true);
  };

  return authorized ? <MainShell onLocked={signOut} /> : <LoginScreen onSession={handleSession} />;
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
