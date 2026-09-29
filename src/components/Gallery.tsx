import type { Entry } from '../api/types';
import type { Selection } from '../lib/selection';
import { EntryCard } from './EntryCard';
import type { EntryCardHandlers } from './EntryCard';

export interface DisplayItem {
  entry: Entry;
  /** показывается вместо размера/домена: путь папки в результатах поиска */
  caption?: string;
}

/** Сетка карточек (UF-3) с пустым состоянием «Здесь пока пусто» (UF-1). */
export function Gallery({
  items,
  loading,
  isSearch,
  selection,
  renamingId,
  handlers,
}: {
  items: DisplayItem[];
  loading: boolean;
  isSearch: boolean;
  selection: Selection;
  renamingId: number | null;
  handlers: EntryCardHandlers;
}) {
  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center" aria-busy="true">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-accent" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2 text-center">
        <span className="text-4xl opacity-40">{isSearch ? '🔍' : '🗃️'}</span>
        <p className="text-sm text-zinc-400">{isSearch ? 'Ничего не найдено' : 'Здесь пока пусто'}</p>
        {!isSearch && (
          <p className="text-xs text-zinc-600">
            Перетащите сюда файлы или папки · «Импорт» сверху · Ctrl+V — вставить ссылку или картинку
          </p>
        )}
      </div>
    );
  }

  return (
    <div
      data-gallery=""
      className="grid gap-3"
      style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))' }}
    >
      {items.map((item) => (
        <EntryCard
          key={item.entry.id}
          entry={item.entry}
          caption={item.caption}
          selected={selection.has(item.entry.id)}
          renaming={renamingId === item.entry.id}
          handlers={handlers}
        />
      ))}
    </div>
  );
}
