// Per-portal error containment (one ErrorBoundary + Suspense per
// portal). A void renderer throwing must not take down the rest of the
// editor -- only its own portal's content is replaced with `fallback`.

import type { ErrorInfo, ReactNode } from "react";
import { Component } from "react";

export interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Console.error only, no telemetry hook -- add one if a host
    // app needs to report void-renderer crashes somewhere.
    console.error("[@jul-editor/react] a void renderer threw", error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) return this.props.fallback ?? null;
    return this.props.children;
  }
}
