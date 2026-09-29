/** UF-9: панель массовых действий при выделении. Переименовать — только одно. */
export function SelectionBar({
  count,
  canDownload,
  onDownload,
  onRename,
  onDelete,
  onClear,
}: {
  count: number;
  canDownload: boolean; // в выделении есть что скачивать (у ссылок нечего)
  onDownload: () => void;
  onRename: () => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  const btn =
    'rounded-full px-3 py-1 text-sm text-zinc-200 transition hover:bg-zinc-700 disabled:pointer-events-none disabled:opacity-40';
  return (
    <div
      role="toolbar"
      aria-label="Действия с выделенным"
      className="fixed bottom-12 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1 rounded-full border border-zinc-700 bg-zinc-900/95 px-4 py-1.5 shadow-2xl backdrop-blur"
    >
      <span className="px-2 text-sm tabular-nums text-zinc-300">Выбрано: {count}</span>
      <button type="button" className={btn} disabled={!canDownload} onClick={onDownload}>
        Скачать
      </button>
      <button
        type="button"
        className={btn}
        disabled={count !== 1}
        title="Переименовать (F2)"
        onClick={onRename}
      >
        Переименовать
      </button>
      <button
        type="button"
        className={`${btn} text-red-300 hover:bg-red-950`}
        title="Удалить (Delete)"
        onClick={onDelete}
      >
        Удалить
      </button>
      <button
        type="button"
        aria-label="Снять выделение"
        className="rounded-full p-1.5 text-zinc-500 transition hover:bg-zinc-700 hover:text-zinc-200"
        title="Снять выделение (Esc)"
        onClick={onClear}
      >
        ✕
      </button>
    </div>
  );
}
