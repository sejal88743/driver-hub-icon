import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import './styles.css';
import { toast } from '@/hooks/use-toast';

// Safe sandboxed iframe replacement for window.alert
if (typeof window !== 'undefined') {
  window.alert = (message?: any) => {
    try {
      const msgStr = typeof message === 'object' ? JSON.stringify(message) : String(message ?? '');
      toast({
        title: 'Notification',
        description: msgStr,
      });
    } catch {
      console.log('[Notification]', message);
    }
  };
}

const queryClient = new QueryClient();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </BrowserRouter>
  </StrictMode>
);
