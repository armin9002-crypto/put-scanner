import { Component, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  title?: string;
  message?: string;
  onRetry?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(): void {
    // Keep production UI calm; build tooling can still surface errors during development.
  }

  reset = (): void => {
    this.setState({ hasError: false });
    this.props.onRetry?.();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div
        className="rounded-xl p-6 text-center"
        style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
      >
        <h2 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
          {this.props.title ?? 'Something went wrong'}
        </h2>
        <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
          {this.props.message ?? 'This section could not render. Try refreshing it.'}
        </p>
        {this.props.onRetry && (
          <button
            type="button"
            onClick={this.reset}
            className="mt-4 rounded-lg px-4 py-2 text-sm font-medium text-white"
            style={{ backgroundColor: 'var(--accent)' }}
          >
            Retry
          </button>
        )}
      </div>
    );
  }
}
