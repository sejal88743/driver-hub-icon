import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import './styles.css';
import { toast } from '@/hooks/use-toast';

// Safe sandboxed iframe replacement for window.alert and suppression of benign extension/HMR errors
if (typeof window !== 'undefined') {
  // Suppress third-party Chrome extension errors (e.g. contentScript.js, share-modal.js) from interrupting the app
  window.addEventListener('error', (event) => {
    const filename = String(event?.filename || '');
    const message = String(event?.message || '');
    if (
      filename.includes('chrome-extension://') ||
      filename.includes('moz-extension://') ||
      filename.includes('contentScript') ||
      filename.includes('share-modal.js') ||
      message.includes('reading \'sentence\'') ||
      message.includes('Cannot read properties of undefined') ||
      (message.includes("Cannot read properties of null (reading 'addEventListener')") && (filename.includes('extension') || !filename || filename.includes('modal')))
    ) {
      event.preventDefault();
      event.stopPropagation();
      return true;
    }
  }, true);

  // Suppress unhandled promise rejections from extensions, benign WebSocket closures, and heartbeat timeouts
  window.addEventListener('unhandledrejection', (event) => {
    const reasonStr = String(event?.reason?.message || event?.reason || '');
    const stackStr = String(event?.reason?.stack || '');
    if (
      reasonStr.includes('sentence') ||
      reasonStr.includes('WebSocket closed without opened') ||
      reasonStr.includes('failed to connect to websocket') ||
      reasonStr.includes('heartbeat timeout') ||
      stackStr.includes('contentScript') ||
      stackStr.includes('chrome-extension://') ||
      stackStr.includes('moz-extension://')
    ) {
      event.preventDefault();
      event.stopPropagation();
      return true;
    }
  });

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
