import { Component, type ErrorInfo, type ReactNode } from 'react';

import {
  browserKioskRuntimeRecovery,
  type BrowserRuntimeRecoveryController
} from '../features/kiosk/browserKioskRuntimeRecovery';

interface AppErrorBoundaryProps {
  children: ReactNode;
  runtimeRecovery?: BrowserRuntimeRecoveryController;
}

interface AppErrorBoundaryState {
  failed: boolean;
  reloading: boolean;
}

const INITIAL_STATE: AppErrorBoundaryState = {
  failed: false,
  reloading: false
};

export class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state = INITIAL_STATE;

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { failed: true, reloading: false };
  }

  componentDidCatch(error: unknown, _info: ErrorInfo): void {
    const runtime = this.props.runtimeRecovery ?? browserKioskRuntimeRecovery;
    let decision;
    try {
      decision = runtime.decide(error);
    } catch {
      return;
    }
    if (decision.kind !== 'reload') return;

    this.setState({ reloading: true }, () => {
      try {
        runtime.replace(decision.href);
      } catch {
        this.setState({ reloading: false });
      }
    });
  }

  private readonly reload = (): void => {
    const runtime = this.props.runtimeRecovery ?? browserKioskRuntimeRecovery;
    try {
      runtime.reload();
    } catch {
      // Keep the recovery controls visible if the browser rejects navigation.
    }
  };

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;

    if (this.state.reloading) {
      return (
        <main
          className="flex min-h-[100dvh] items-center justify-center bg-slate-950 px-6 text-white"
          role="status"
          aria-live="polite"
        >
          <div className="text-center">
            <span
              className="mx-auto mb-5 block h-12 w-12 animate-spin rounded-full border-4 border-white/25 border-t-white"
              aria-hidden="true"
            />
            <p className="text-2xl font-bold">画面を復旧しています…</p>
          </div>
        </main>
      );
    }

    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-slate-950 px-6 py-10 text-white">
        <section className="w-full max-w-2xl rounded-2xl border border-white/20 bg-slate-900 p-8 text-center shadow-2xl">
          <h1 className="text-3xl font-bold">画面を表示できませんでした</h1>
          <p className="mt-5 text-xl leading-relaxed text-slate-200">
            一時的な読み込みエラーの可能性があります。下のボタンでもう一度読み込んでください。
          </p>
          <button
            type="button"
            className="mt-8 min-h-20 w-full rounded-xl bg-sky-600 px-8 py-5 text-2xl font-bold text-white shadow-lg transition hover:bg-sky-500 focus:outline-none focus:ring-4 focus:ring-sky-300"
            onClick={this.reload}
          >
            画面を再読み込み
          </button>
        </section>
      </main>
    );
  }
}
