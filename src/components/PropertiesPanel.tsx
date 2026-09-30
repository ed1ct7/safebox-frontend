import { useEffect, useState } from 'react';
import type { Entry, EntryPatch } from '../api/types';
import { useThumbnailSrc } from '../hooks/useThumbnailSrc';
import { formatBytes, formatDateTime, plural } from '../lib/format';
import { displayName } from '../lib/link';
import { validateDescription, validateEntryName, validateLinkUrl } from '../lib/rules';
import { EditableField } from './EditableField';
import { GLYPHS, KIND_LABELS } from './EntryCard';
import { TagsSection } from './TagsSection';

/** Что показывает панель: выделенные записи или, если выделения нет, открытая папка. */
export interface PropertiesTarget {
  entries: Entry[];
  scope: 'selection' | 'container';
}

function Row({ label, children }: { label: string; children: string }) {
  return (
    <>
      <dt className="text-zinc-500">{label}</dt>
      <dd className="min-w-0 break-words text-zinc-200">{children}</dd>
    </>
  );
}

function Preview({ entry }: { entry: Entry }) {
  const src = useThumbnailSrc(entry);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return (
    <div className="flex h-40 items-center justify-center overflow-hidden rounded-lg bg-zinc-950">
      {entry.hasThumbnail && !failed ? (
        <img
          src={src}
          alt=""
          draggable={false}
          onError={() => setFailed(true)}
          className="h-full w-full object-contain"
        />
      ) : (
        <span className="text-5xl opacity-50">{GLYPHS[entry.kind]}</span>
      )}
    </div>
  );
}

const NO_NAMES: ReadonlyMap<number, string> = new Map();
const noop = () => undefined;

function EntryDetails({
  entry,
  onSave,
  sourceNames,
  onOpenSource,
  onFilterTag,
  focusTags,
  onTagsFocused,
}: {
  entry: Entry;
  onSave: (id: number, patch: EntryPatch) => Promise<void>;
  sourceNames: ReadonlyMap<number, string>;
  onOpenSource: (id: number) => void;
  onFilterTag?: (tagId: number) => void;
  focusTags: boolean;
  onTagsFocused: () => void;
}) {
  const isLink = entry.kind === 'link';
  const save = (patch: EntryPatch) => onSave(entry.id, patch);
  const kind = entry.mime === '' ? KIND_LABELS[entry.kind] : `${KIND_LABELS[entry.kind]} · ${entry.mime}`;

  return (
    <div className="flex flex-col gap-4">
      <Preview entry={entry} />
      <EditableField
        label="Имя"
        value={displayName(entry)}
        validate={validateEntryName}
        onSave={(name) => save({ name })}
      />
      {isLink && (
        <EditableField
          label="Адрес"
          value={entry.url ?? ''}
          placeholder="https://"
          validate={validateLinkUrl}
          onSave={(url) => save({ url })}
        />
      )}
      <EditableField
        label="Описание"
        value={entry.description}
        multiline
        placeholder="Заметки об этой записи"
        validate={validateDescription}
        onSave={(description) => save({ description })}
      />
      <dl className="grid grid-cols-[7.5rem_1fr] gap-x-3 gap-y-1.5 text-xs">
        <Row label="Тип">{kind}</Row>
        {entry.kind !== 'folder' && <Row label="Размер">{formatBytes(entry.size)}</Row>}
        <Row label="Создано">{formatDateTime(entry.createdAt)}</Row>
        <Row label="Изменено">{formatDateTime(entry.modifiedAt)}</Row>
        {entry.sourceModifiedAt !== null && (
          <Row label="Изменён на диске">{formatDateTime(entry.sourceModifiedAt)}</Row>
        )}
        <Row label={entry.kind === 'folder' ? 'Содержимое' : 'Вложения'}>{String(entry.childCount)}</Row>
      </dl>
      <TagsSection
        entry={entry}
        sourceNames={sourceNames}
        onOpenSource={onOpenSource}
        onFilterTag={onFilterTag}
        focusRequested={focusTags}
        onFocused={onTagsFocused}
      />
    </div>
  );
}

/**
 * Панель свойств слева от галереи (UF-22): не модалка, следует за выделением -
 * теги, описание и реквизиты открытой записи видны рядом с ней. Имя, адрес
 * ссылки, описание и теги правятся на месте (EditableField, TagsSection).
 * Закрывается кнопкой ✕ или Esc (обрабатывает MainShell).
 * sourceNames и onOpenSource - для унаследованных тегов (имя и переход к записи,
 * от которой тег), focusTagsFor - запись, чьё поле тегов надо сфокусировать («Теги…»).
 */
export function PropertiesPanel({
  target,
  onSave,
  onClose,
  sourceNames = NO_NAMES,
  onOpenSource = noop,
  onFilterTag,
  focusTagsFor = null,
  onTagsFocused = noop,
}: {
  target: PropertiesTarget;
  onSave: (id: number, patch: EntryPatch) => Promise<void>;
  onClose: () => void;
  sourceNames?: ReadonlyMap<number, string>;
  onOpenSource?: (id: number) => void;
  /** клик по тегу записи - фильтр по нему на весь сейф */
  onFilterTag?: (tagId: number) => void;
  focusTagsFor?: number | null;
  onTagsFocused?: () => void;
}) {
  const { entries, scope } = target;
  const [single] = entries;

  let body: JSX.Element;
  if (single === undefined) {
    body = <p className="text-sm text-zinc-500">Выделите запись, чтобы увидеть её свойства.</p>;
  } else if (entries.length > 1) {
    const total = entries.reduce((sum, e) => sum + (e.kind === 'folder' ? 0 : e.size), 0);
    body = (
      <div className="flex flex-col gap-2 text-sm text-zinc-300">
        <p>Выбрано: {plural(entries.length, 'объект', 'объекта', 'объектов')}</p>
        <p className="text-xs text-zinc-500">Общий размер файлов: {formatBytes(total)}</p>
        <p className="text-xs text-zinc-600">Выделите одну запись, чтобы изменить её свойства.</p>
      </div>
    );
  } else {
    // key: черновики полей не переходят на другую запись
    body = (
      <EntryDetails
        key={single.id}
        entry={single}
        onSave={onSave}
        sourceNames={sourceNames}
        onOpenSource={onOpenSource}
        onFilterTag={onFilterTag}
        focusTags={focusTagsFor === single.id}
        onTagsFocused={onTagsFocused}
      />
    );
  }

  return (
    <aside
      aria-label="Свойства"
      className="w-80 shrink-0 overflow-y-auto border-r border-zinc-800 bg-zinc-950 p-4 pb-20"
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium text-zinc-100">
          Свойства
          {scope === 'container' && single !== undefined && (
            <span className="ml-2 text-xs font-normal text-zinc-500">открытая папка</span>
          )}
        </h2>
        <button
          type="button"
          aria-label="Закрыть свойства (Esc)"
          title="Закрыть (Esc)"
          className="rounded p-1.5 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200"
          onClick={onClose}
        >
          ✕
        </button>
      </div>
      {body}
    </aside>
  );
}
