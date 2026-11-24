import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { PageLoader } from '../design-system';
import { ApiError } from '../lib/api';
import { AuthProvider, useAuth } from '../lib/auth';
import { LoginPage, RegisterPage } from '../pages/auth/AuthPages';
import { HomePage } from '../pages/Home';
import { AirtimePage, HelpPage, NotFoundPage } from '../pages/Misc';
import { RecipientsPage } from '../pages/Recipients';
import { SendMoneyPage } from '../pages/send/SendMoney';
import { ReceiptPage, TransactionDetailPage } from '../pages/TransactionDetail';
import { TransactionsPage } from '../pages/Transactions';
import { AppShell } from './AppShell';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
    },
    mutations: { retry: false }, // never auto-retry money-moving requests
  },
});

function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <PageLoader />;
  if (status === 'signed-out') return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <>{children}</>;
}

function PublicOnly({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  if (status === 'loading') return <PageLoader />;
  if (status === 'signed-in') return <Navigate to="/" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<PublicOnly><LoginPage /></PublicOnly>} />
            <Route path="/register" element={<PublicOnly><RegisterPage /></PublicOnly>} />
            <Route element={<RequireAuth><AppShell /></RequireAuth>}>
              <Route path="/" element={<HomePage />} />
              <Route path="/send" element={<SendMoneyPage />} />
              <Route path="/recipients" element={<RecipientsPage />} />
              <Route path="/transfers" element={<TransactionsPage />} />
              <Route path="/transfers/:id" element={<TransactionDetailPage />} />
              <Route path="/transfers/:id/receipt" element={<ReceiptPage />} />
              <Route path="/airtime" element={<AirtimePage />} />
              <Route path="/help" element={<HelpPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
