export function RouteLoadingScreen() {
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
        <p className="text-2xl font-bold">画面を準備しています…</p>
      </div>
    </main>
  );
}
