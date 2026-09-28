import type { Entry } from '../api/types';
import type { MouseEvent } from 'react';
import { EntryCard } from './EntryCard';

export interface DisplayItem {
  entry: Entry;
  /** показывается вместо размера/домена: путь папки в результатах поиска */
  caption?: string;
}

export function Gallery({
  items,
  loading,
  isSearch,
  selection,
  renamingId,
  onCardClick,
  onToggleSelect,
  onContextMenu,
  onRenameStart,
  onRenameCommit,
  onRenameCancel,
  onHover,
}: {
  items: DisplayItem[];
  loading: boolean;
  isSearch: boolean;
  selection: Set<number>;
  renamingId: number | null;
  onCardClick: (e: MouseEvent, entry: Entry) => void;
  onToggleSelect: (id: number) => void;
  onContextMenu: (e: MouseEvent, entry: Entry) => void;
  onRenameStart: (id: number) => void;
  onRenameCommit: (id: number, name: string) => void;
  onRenameCancel: () => void;
  onHover: (id: number | null) => void;
}) {
  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-accent" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2 text-center">
        <span className="text-4xl opacity-40">{isSearch ? '🔍' : '🗃️'}</span>
        <p className="text-sm text-zinc-400">
          {isSearch ? 'Ничего не найдено' : 'Здесь пока пусто'}
        </p>
        {!isSearch && (
          <p className="text-xs text-zinc-600">
            Перетащите сюда файлы или папки · Ctrl+V — добавить ссылку
          </p>
        )}
      </div>
    );
  }

  return (
    <div
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
          onClick={onCardClick}
          onToggleSelect={onToggleSelect}
          onContextMenu={onContextMenu}
          onRenameStart={onRenameStart}
          onRenameCommit={onRenameCommit}
          onRenameCancel={onRenameCancel}
          onHover={onHover}
        />
      ))}
    </div>
  );
}
