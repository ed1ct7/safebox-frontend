import { memo, useState } from 'react';
import type { MouseEvent } from 'react';
import type { Entry, EntryKind } from '../api/types';
import { mediaUrl } from '../api/endpoints';
import { formatBytes } from '../lib/format';
import { displayName } from '../lib/link';
import { NameEditor } from './NameEditor';

export const GLYPHS: Record<EntryKind, string> = {
  folder: '📁',
  photo: '🖼️',
  video: '🎬',
  link: '🔗',
  file: '📄',
};

const KIND_LABELS: Record<EntryKind, string> = {
  folder: 'Папка',
  photo: 'Фото',
  video: 'Видео',
  link: 'Ссылка',
  file: 'Файл',
};

function captionOf(entry: Entry): string {
  if (entry.kind === 'folder') return 'Папка';
  if (entry.kind === 'link') return entry.domain ?? '';
  return formatBytes(entry.size);
}

export interface EntryCardHandlers {
  onClick: (e: MouseEvent, entry: Entry) => void;
  onToggleSelect: (id: number) => void;
  onContextMenu: (e: MouseEvent, entry: Entry) => void;
  onRenameStart: (id: number) => void;
  onRenameCommit: (id: number, name: string) => void;
  onRenameCancel: () => void;
  onHover: (id: number | null) => void;
}

/**
 * Карточка (UF-3): миниатюра у фото (лениво, при прокрутке), заглушка у
 * остальных, подпись, размер/домен, бейдж типа. memo: при выделении
 * перерисовываются только карточки, чьё состояние изменилось.
 */
export const EntryCard = memo(function EntryCard({
  entry,
  caption,
  selected,
  renaming,
  handlers,
}: {
  entry: Entry;
  caption?: string;
  selected: boolean;
  renaming: boolean;
  handlers: EntryCardHandlers;
}) {
  const [thumbFailed, setThumbFailed] = useState(false);
  const name = displayName(entry);

  return (
    <div
      className={`group relative flex cursor-pointer select-none flex-col rounded-xl border bg-zinc-900/60 transition ${
        selected ? 'border-accent ring-1 ring-accent' : 'border-zinc-800 hover:border-zinc-600'
      }`}
      onClick={(e) => handlers.onClick(e, entry)}
      onContextMenu={(e) => handlers.onContextMenu(e, entry)}
      onMouseEnter={() => handlers.onHover(entry.id)}
      onMouseLeave={() => handlers.onHover(null)}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={selected}
        aria-label={`Выбрать «${name}»`}
        className={`absolute left-2 top-2 z-10 flex h-5 w-5 items-center justify-center rounded border text-[11px] leading-none ${
          selected
            ? 'border-accent bg-accent text-white opacity-100'
            : 'border-zinc-500 bg-zinc-950/80 text-transparent opacity-0 transition focus:opacity-100 group-hover:opacity-100'
        }`}
        onClick={(e) => {
          e.stopPropagation();
          handlers.onToggleSelect(entry.id);
        }}
      >
        ✓
      </button>

      <span
        className="absolute right-2 top-2 z-10 rounded bg-black/60 px-1.5 py-0.5 text-[11px] leading-none"
        title={KIND_LABELS[entry.kind]}
      >
        {GLYPHS[entry.kind]}
      </span>

      <div className="mx-2 mt-2 flex aspect-[4/3] items-center justify-center overflow-hidden rounded-lg bg-zinc-950">
        {entry.kind === 'photo' && entry.hasThumbnail && !thumbFailed ? (
          <img
            src={mediaUrl(entry.id, 'thumbnail')}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
            onError={() => setThumbFailed(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="text-4xl opacity-50">{GLYPHS[entry.kind]}</span>
        )}
      </div>

      <div className="min-w-0 px-3 pb-2.5 pt-2">
        {renaming ? (
          <NameEditor
            initial={entry.name}
            onCommit={(newName) => handlers.onRenameCommit(entry.id, newName)}
            onCancel={handlers.onRenameCancel}
          />
        ) : (
          <div className="flex items-center gap-1">
            <span className="truncate text-sm text-zinc-200" title={name}>
              {name}
            </span>
            <button
              type="button"
              aria-label="Переименовать (F2)"
              title="Переименовать (F2)"
              className="shrink-0 text-xs text-zinc-500 opacity-0 transition hover:text-zinc-200 focus:opacity-100 group-hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                handlers.onRenameStart(entry.id);
              }}
            >
              ✎
            </button>
          </div>
        )}
        <div className="truncate text-xs text-zinc-500" title={caption}>
          {caption ?? captionOf(entry)}
        </div>
      </div>
    </div>
  );
});
