import type { Entry } from '../api/types';

/** UF-6: без подтверждения внешняя страница не открывается. Enter — «Открыть». */
export function LinkConfirm({ entry, onClose }: { entry: Entry; onClose: () => void }) {
  const url = entry.url ?? '';
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-medium text-zinc-100">Открыть внешнюю ссылку?</h3>
        <p className="mt-3 text-sm text-zinc-300">
          {entry.name}
          {entry.domain !== undefined && (
            <span className="text-zinc-500"> · {entry.domain}</span>
          )}
        </p>
        <p className="mt-1 break-all text-sm text-accent-hover">{url}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            className="rounded-lg px-3 py-1.5 text-sm text-zinc-400 transition hover:text-zinc-200"
            onClick={onClose}
          >
            Отмена
          </button>
          <button
            autoFocus
            className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white transition hover:bg-accent-hover"
            onClick={() => {
              window.open(url, '_blank', 'noopener,noreferrer');
              onClose();
            }}
          >
            Открыть
          </button>
        </div>
      </div>
    </div>
  );
}
