import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

// ────────────────────────────────────────────────────────────────────────────
// Error fallback component
// ────────────────────────────────────────────────────────────────────────────

interface ErrorFallbackProps {
  readonly error: Error;
  readonly onRetry: () => void;
}

function ErrorFallback({ error, onRetry }: ErrorFallbackProps) {
  const { t } = useTranslation();

  return (
    <div
      className="flex flex-col items-center justify-center gap-4 rounded-lg border border-red-300 bg-red-50 p-8 dark:border-red-800 dark:bg-red-950"
      data-testid="error-boundary-fallback"
    >
      <div className="text-4xl">⚠️</div>
      <h3 className="text-lg font-semibold text-red-700 dark:text-red-300">
        {t('machines.error.title')}
      </h3>
      <p className="max-w-md text-center text-sm text-red-600 dark:text-red-400">{error.message}</p>
      <button
        onClick={onRetry}
        className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm text-white hover:opacity-90"
        data-testid="error-retry-btn"
      >
        {t('machines.error.retry')}
      </button>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Error boundary (class component — required for componentDidCatch)
// ────────────────────────────────────────────────────────────────────────────

interface ErrorBoundaryProps {
  readonly children: ReactNode;
  readonly fallback?: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary] Caught rendering error:', error, info.componentStack);
  }

  handleRetry = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback;
      return <ErrorFallback error={this.state.error} onRetry={this.handleRetry} />;
    }
    return this.props.children;
  }
}
