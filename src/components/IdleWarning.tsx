/** UF-13 (SHOULD): предупреждение за минуту до автоблокировки. */
export function IdleWarning({ seconds, onStay }: { seconds: number; onStay: () => void }) {
  return (
    <div className="fixed left-1/2 top-4 z-40 flex -translate-x-1/2 items-center gap-3 rounded-full border border-amber-700/60 bg-amber-950/90 px-4 py-2 text-sm text-amber-200 shadow-xl">
      <span>⚠ Автоблокировка через {seconds} с</span>
      <button
        autoFocus
        className="rounded-full bg-amber-600 px-3 py-0.5 font-medium text-black transition hover:bg-amber-500"
        onClick={onStay}
      >
        Остаться
      </button>
    </div>
  );
}
