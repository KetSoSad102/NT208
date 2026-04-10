import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import './styles.css';

const queryClient = new QueryClient();

type ErrorBoundaryState = {
  hasError: boolean;
  message: string;
};

class AppErrorBoundary extends React.Component<React.PropsWithChildren, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
    message: '',
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error.message || 'Unknown frontend error',
    };
  }

  componentDidCatch(error: Error): void {
    // Keep runtime errors visible in container logs for fast debugging.
    console.error('Frontend runtime error:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 24, color: '#7f1d1d' }}>
          <h2>Frontend gặp lỗi runtime</h2>
          <p>{this.state.message}</p>
          <p>Hãy reload trang hoặc đăng nhập lại.</p>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </AppErrorBoundary>
  </React.StrictMode>,
);
