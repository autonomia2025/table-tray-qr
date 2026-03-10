import { Component, ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: any) {
    console.error("ErrorBoundary caught:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 text-center">
          <p className="text-5xl mb-4">⚠️</p>
          <h2 className="text-lg font-bold text-foreground mb-2">Algo salió mal</h2>
          <p className="text-sm text-muted-foreground mb-6 max-w-[280px]">
            Ocurrió un error inesperado. Por favor recarga la página.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-white"
          >
            Recargar
          </button>
          {process.env.NODE_ENV === "development" && (
            <pre className="mt-4 text-left text-xs text-red-500 max-w-full overflow-auto">
              {this.state.error?.message}
            </pre>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}
