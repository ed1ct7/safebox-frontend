import { useState } from 'react';
import {
  CONFLICT_TEXTS,
  conflictTitle,
  resolutionsFromChoices,
  uniformResolutions,
  unresolvedCount,
} from '../lib/conflicts';
import type { Choice, ConflictRequest, ConflictSide } from '../lib/conflicts';
import { formatBytes, formatDateTime } from '../lib/format';
import type { Resolutions } from '../lib/importPlan';
import { DialogPanel, Modal } from './Modal';

const linkButton = 'rounded-lg px-3 py-1.5 text-sm text-zinc-400 transition hover:text-zinc-200';
const outlineButton =
  'rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 transition hover:border-zinc-500';

function sideText(side: ConflictSide): string {
  const size = side.folder ? 'Папка' : side.size === null ? '—' : formatBytes(side.size);
  return `${size} · ${side.modifiedAt === null ? '—' : formatDateTime(side.modifiedAt)}`;
}

/**
 * Имя уже занято (UF-15 при импорте, UF-14 при перемещении): «Заменить»,
 * «Пропустить» или решение по каждому файлу двумя галочками, как в проводнике:
 * только «приходящий» - заменить, только «лежащий» - пропустить, оба - оставить оба.
 * onDone(null) - отмена всей операции (кнопка, Esc, клик мимо).
 */
export function ConflictDialog({
  request,
  onDone,
}: {
  request: ConflictRequest;
  onDone: (resolutions: Resolutions | null) => void;
}) {
  const { items, kind } = request;
  const texts = CONFLICT_TEXTS[kind];
  const title = conflictTitle(kind, items.length);
  const [each, setEach] = useState(false);
  const [choices, setChoices] = useState<ReadonlyMap<string, Choice>>(new Map());

  const resolutions = resolutionsFromChoices(items, choices);
  const unresolved = unresolvedCount(items, choices);

  const setChoice = (key: string, change: Partial<Choice>) =>
    setChoices((prev) => {
      const next = new Map(prev);
      next.set(key, { incoming: false, existing: false, ...prev.get(key), ...change });
      return next;
    });

  const setColumn = (side: keyof Choice, value: boolean) =>
    setChoices((prev) => {
      const next = new Map(prev);
      for (const i of items) {
        next.set(i.key, { incoming: false, existing: false, ...prev.get(i.key), [side]: value });
      }
      return next;
    });

  const columnChecked = (side: keyof Choice) =>
    items.length > 0 && items.every((i) => choices.get(i.key)?.[side] === true);

  return (
    <Modal onClose={() => onDone(null)} label={title}>
      <DialogPanel title={title} wide={each}>
        {!each ? (
          <>
            <p className="mt-3 text-sm text-zinc-400">
              Что сделать с файлами, у которых имя совпало?
            </p>
            <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
              <button type="button" className={`${linkButton} mr-auto`} onClick={() => onDone(null)}>
                Отмена
              </button>
              <button type="button" className={outlineButton} onClick={() => setEach(true)}>
                Решить для каждого файла
              </button>
              <button
                type="button"
                autoFocus
                className={outlineButton}
                onClick={() => onDone(uniformResolutions(items, 'skip'))}
              >
                Пропустить
              </button>
              <button
                type="button"
                className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white transition hover:bg-accent-hover"
                onClick={() => onDone(uniformResolutions(items, 'replace'))}
              >
                Заменить
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="mt-3 text-sm text-zinc-400">
              Отметьте, что оставить: только «{texts.incoming}» - заменить, только «{texts.existing}»
              - пропустить, обе - оставить оба (новый получит имя «имя (2)»).
            </p>
            <div className="mt-3 grid grid-cols-2 gap-3 border-b border-zinc-800 pb-2 text-xs text-zinc-400">
              {(['incoming', 'existing'] as const).map((side) => (
                <label key={side} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="accent-indigo-500"
                    aria-label={`Отметить все: ${texts[side]}`}
                    checked={columnChecked(side)}
                    onChange={(e) => setColumn(side, e.target.checked)}
                  />
                  Все: {texts[side]}
                </label>
              ))}
            </div>
            <ul className="max-h-[50vh] overflow-y-auto">
              {items.map((item) => {
                const choice = choices.get(item.key);
                return (
                  <li key={item.key} className="border-b border-zinc-800/60 py-2">
                    <p className="truncate text-sm text-zinc-200" title={item.name}>
                      {item.name}
                    </p>
                    <div className="mt-1 grid grid-cols-2 gap-3">
                      {(['incoming', 'existing'] as const).map((side) => (
                        <label key={side} className="flex cursor-pointer items-start gap-2">
                          <input
                            type="checkbox"
                            className="mt-0.5 accent-indigo-500"
                            checked={choice?.[side] === true}
                            onChange={(e) => setChoice(item.key, { [side]: e.target.checked })}
                          />
                          <span className="min-w-0">
                            <span className="block text-sm text-zinc-300">{texts[side]}</span>
                            <span className="block truncate text-xs text-zinc-500">
                              {sideText(item[side])}
                            </span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="mt-4 flex items-center justify-end gap-2">
              {unresolved > 0 && (
                <span className="mr-auto text-xs text-zinc-500">Не выбрано: {unresolved}</span>
              )}
              <button type="button" className={linkButton} onClick={() => onDone(null)}>
                Отмена
              </button>
              <button
                type="button"
                disabled={resolutions === null}
                className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white transition hover:bg-accent-hover disabled:pointer-events-none disabled:opacity-40"
                onClick={() => {
                  if (resolutions !== null) onDone(resolutions);
                }}
              >
                Продолжить
              </button>
            </div>
          </>
        )}
      </DialogPanel>
    </Modal>
  );
}
