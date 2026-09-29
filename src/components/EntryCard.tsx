import { memo, useEffect, useMemo, useState } from 'react';
import type { DragEvent, MouseEvent } from 'react';
import type { Entry, EntryKind, SearchHit } from '../api/types';
import { useEntryDrop } from '../hooks/useEntryDrop';
import { useTagCatalog } from '../hooks/useTagCatalog';
import { useThumbnailSrc } from '../hooks/useThumbnailSrc';
import { firstLine, formatBytes } from '../lib/format';
import { displayName } from '../lib/link';
import { cardTagChips } from '../lib/tags';
import { NameEditor } from './NameEditor';

export const GLYPHS: Record<EntryKind, string> = {
  folder: '📁',
  photo: '🖼️',
  video: '🎬',
  link: '🔗',
  file: '📄',
};

export const KIND_LABELS: Record<EntryKind, string> = {
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

/** Всплывающая подсказка: имя и первая строка описания (у ссылки описание видно на карточке). */
function tooltipOf(entry: Entry, name: string): string {
  const description = entry.kind === 'link' ? '' : firstLine(entry.description);
  return description === '' ? name : `${name}\n${description}`;
}

export interface EntryCardHandlers {
  onClick: (e: MouseEvent, entry: Entry) => void;
  onToggleSelect: (id: number) => void;
  onContextMenu: (e: MouseEvent, entry: Entry) => void;
  onRenameStart: (id: number) => void;
  onRenameCommit: (id: number, name: string) => void;
  onRenameCancel: () => void;
  onHover: (id: number | null) => void;
  /** перетаскивание карточек на папку или запись (UF-14) */
  onDragStart: (e: DragEvent, entry: Entry) => void;
  onDragEnd: () => void;
  canDropOn: (entry: Entry) => boolean;
  onDropOn: (entry: Entry) => void;
  /** ссылка из браузера брошена на карточку - станет её вложением (UF-20) */
  onDropLink?: (entry: Entry, dt: DataTransfer) => void;
}

/**
 * Карточка (UF-3, UF-6, UF-14): миниатюра (лениво, при прокрутке) или заглушка,
 * подпись, размер/домен, бейдж типа и число вложений. У ссылки - картинка
 * предпросмотра, домен и первая строка описания, пока предпросмотр грузится
 * (previewPending) - индикатор (UF-21). Теги (UF-16): первые три
 * (прямые, потом бледные унаследованные) и «+N». memo: при выделении
 * перерисовываются только карточки, чьё состояние изменилось.
 */
export const EntryCard = memo(function EntryCard({
  entry,
  caption,
  matchedIn,
  selected,
  renaming,
  fresh = false,
  handlers,
}: {
  entry: Entry;
  caption?: string;
  matchedIn?: SearchHit['matchedIn'];
  selected: boolean;
  renaming: boolean;
  fresh?: boolean; // только что добавлена: подсвечивается на пару секунд (UF-20)
  handlers: EntryCardHandlers;
}) {
  const [thumbFailed, setThumbFailed] = useState(false);
  const thumbSrc = useThumbnailSrc(entry);
  const name = displayName(entry);
  const catalog = useTagCatalog();
  const { chips, more } = useMemo(() => cardTagChips(entry, catalog), [entry, catalog]);
  const dropLink = handlers.onDropLink;
  const drop = useEntryDrop(
    () => handlers.canDropOn(entry),
    () => handlers.onDropOn(entry),
    dropLink === undefined ? undefined : (dt) => dropLink(entry, dt),
  );

  // новая миниатюра (замена, обновление предпросмотра) получает новую попытку
  useEffect(() => setThumbFailed(false), [thumbSrc]);

  const description = entry.kind === 'link' ? firstLine(entry.description) : '';

  return (
    <div
      className={`group relative flex cursor-pointer select-none flex-col rounded-xl border bg-zinc-900/60 transition ${
        drop.over
          ? 'border-accent bg-accent/10 ring-2 ring-accent'
          : selected
            ? 'border-accent ring-1 ring-accent'
            : fresh
              ? 'border-emerald-600 ring-1 ring-emerald-600/70'
              : 'border-zinc-800 hover:border-zinc-600'
      }`}
      title={tooltipOf(entry, name)}
      draggable={!renaming}
      onDragStart={(e) => handlers.onDragStart(e, entry)}
      onDragEnd={handlers.onDragEnd}
      {...drop.props}
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

      <div className="relative mx-2 mt-2 flex aspect-[4/3] items-center justify-center overflow-hidden rounded-lg bg-zinc-950">
        {entry.hasThumbnail && !thumbFailed ? (
          <img
            src={thumbSrc}
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
        {matchedIn === 'description' && (
          <span
            className="absolute bottom-1.5 left-1.5 rounded bg-amber-500/25 px-1.5 py-0.5 text-[11px] leading-none text-amber-200"
            title="Совпадение найдено в описании"
          >
            в описании
          </span>
        )}
        {entry.childCount > 0 && (
          <span
            className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[11px] leading-none text-zinc-200"
            title={entry.kind === 'folder' ? `Элементов: ${entry.childCount}` : `Вложений: ${entry.childCount}`}
          >
            {entry.kind === 'folder' ? entry.childCount : `📎 ${entry.childCount}`}
          </span>
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
            <span className="truncate text-sm text-zinc-200">{name}</span>
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
        <div className="flex items-center gap-1.5 text-xs text-zinc-500" title={caption}>
          {entry.previewPending === true && (
            <span
              role="img"
              aria-label="Загружается предпросмотр"
              title="Загружается предпросмотр…"
              className="h-2.5 w-2.5 shrink-0 animate-spin rounded-full border border-zinc-600 border-t-accent"
            />
          )}
          <span className="min-w-0 truncate">{caption ?? captionOf(entry)}</span>
        </div>
        {description !== '' && <div className="truncate text-xs text-zinc-400">{description}</div>}
        {chips.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1" aria-label="Теги">
            {chips.map((chip) => (
              <span
                key={chip.tagId}
                title={chip.inherited ? `${chip.title} (унаследован)` : chip.title}
                className={`max-w-full truncate rounded-full border px-1.5 text-[10px] leading-4 ${
                  chip.inherited
                    ? 'border-zinc-800 text-zinc-600'
                    : 'border-zinc-700 bg-zinc-800/80 text-zinc-300'
                }`}
              >
                {chip.name}
              </span>
            ))}
            {more > 0 && (
              <span
                title={`Ещё тегов: ${more}`}
                className="rounded-full border border-zinc-800 px-1.5 text-[10px] leading-4 text-zinc-500"
              >
                +{more}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
});
