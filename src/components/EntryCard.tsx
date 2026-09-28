import type { MouseEvent } from 'react';
import type { Entry, EntryKind } from '../api/types';
import { mediaUrl } from '../api/endpoints';
import { formatBytes } from '../lib/format';
import { NameEditor } from './NameEditor';

const GLYPHS: Record<EntryKind, string> = {
  folder: '📁',
  photo: '🖼️',
  video: '🎬',
  link: '🔗',
  file: '📄',
};

function captionOf(entry: Entry): string {
  if (entry.kind === 'folder') return 'Папка';
  if (entry.kind === 'link') return entry.domain ?? '';
  return formatBytes(entry.size);
}

export function EntryCard({
  entry,
  caption,
  selected,
  renaming,
  onClick,
  onToggleSelect,
  onContextMenu,
  onRenameStart,
  onRenameCommit,
  onRenameCancel,
  onHover,
}: {
  entry: Entry;
  caption?: string;
  selected: boolean;
  renaming: boolean;
  onClick: (e: MouseEvent, entry: Entry) => void;
  onToggleSelect: (id: number) => void;
  onContextMenu: (e: MouseEvent, entry: Entry) => void;
  onRenameStart: (id: number) => void;
  onRenameCommit: (id: number, name: string) => void;
  onRenameCancel: () => void;
  onHover: (id: number | null) => void;
}) {
  return (
    <div
      className={`group relative flex cursor-pointer select-none flex-col rounded-xl border bg-zinc-900/60 transition ${
        selected ? 'border-accent ring-1 ring-accent' : 'border-zinc-800 hover:border-zinc-600'
      }`}
      onClick={(e) => onClick(e, entry)}
      onContextMenu={(e) => onContextMenu(e, entry)}
      onMouseEnter={() => onHover(entry.id)}
      onMouseLeave={() => onHover(null)}
    >
      <button
        aria-label="Выбрать"
        className={`absolute left-2 top-2 z-10 flex h-5 w-5 items-center justify-center rounded border text-[11px] leading-none ${
          selected
            ? 'border-accent bg-accent text-white opacity-100'
            : 'border-zinc-500 bg-zinc-950/80 text-transparent opacity-0 transition group-hover:opacity-100'
        }`}
        onClick={(e) => {
          e.stopPropagation();
          onToggleSelect(entry.id);
        }}
      >
        ✓
      </button>

      <span className="absolute right-2 top-2 z-10 rounded bg-black/60 px-1.5 py-0.5 text-[11px] leading-none">
        {GLYPHS[entry.kind]}
      </span>

      <div className="mx-2 mt-2 flex aspect-[4/3] items-center justify-center overflow-hidden rounded-lg bg-zinc-950">
        {entry.kind === 'photo' && entry.hasThumbnail ? (
          <img
            src={mediaUrl(entry.id, 'thumbnail')}
            alt=""
            loading="lazy"
            draggable={false}
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
            onCommit={(name) => onRenameCommit(entry.id, name)}
            onCancel={onRenameCancel}
          />
        ) : (
          <div className="flex items-center gap-1">
            <span className="truncate text-sm text-zinc-200" title={entry.name}>
              {/* сервер хранит имя ссылки как «домен.url» — расширение не показываем */}
              {entry.kind === 'link' ? entry.name.replace(/\.url$/i, '') : entry.name}
            </span>
            <button
              aria-label="Переименовать (F2)"
              title="Переименовать (F2)"
              className="shrink-0 text-xs text-zinc-500 opacity-0 transition hover:text-zinc-200 group-hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                onRenameStart(entry.id);
              }}
            >
              ✎
            </button>
          </div>
        )}
        <div className="truncate text-xs text-zinc-500">{caption ?? captionOf(entry)}</div>
      </div>
    </div>
  );
}
