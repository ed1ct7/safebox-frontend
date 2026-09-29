import { useCallback } from 'react';
import { createLinks } from '../api/endpoints';
import { errorMessage, isUnauthorized } from '../api/client';
import { chunk, LINK_BATCH, parseBookmarks } from '../lib/bookmarks';
import { readFileText } from '../lib/dom';
import { bookmarksSummary, linksSummary } from '../lib/format';
import type { BookmarksTotals, ToastSpec } from '../lib/format';
import { parseUrlList } from '../lib/link';
import { useToast } from '../components/Toasts';
import { useEvent } from './useEvent';

/**
 * Создание ссылок (UF-20) - только через POST /links: Ctrl+V, перетаскивание, поле
 * «Ссылка» и импорт закладок. parentId - открытая папка или запись, чьи вложения
 * открыты (для перетаскивания на карточку - сама карточка). Итог - тосты: «Уже есть»
 * ведёт к записи (onShow), «Это не ссылка» / «Пропущено некорректных: N» - про
 * отброшенное. onChanged - список пора обновить, onCreated - id новых записей.
 */
export function useLinks({
  onChanged,
  onCreated,
  onShow,
  onActivity,
}: {
  onChanged: () => void;
  onCreated: (ids: number[]) => void;
  onShow: (entryId: number) => void;
  onActivity: () => void;
}) {
  const toast = useToast();
  const changed = useEvent(onChanged);
  const created = useEvent(onCreated);
  const show = useEvent(onShow);
  const activity = useEvent(onActivity);

  const say = useCallback(
    (specs: ToastSpec[]) => {
      for (const { text, kind, showId } of specs) {
        toast(text, kind, showId === undefined ? undefined : { label: 'Показать', onClick: () => show(showId) });
      }
    },
    [toast, show],
  );

  /** invalid - сколько строк уже отброшено при разборе текста. */
  const addLinks = useCallback(
    async (urls: string[], parentId: number | null, invalid = 0): Promise<void> => {
      if (urls.length === 0) {
        say(linksSummary({ created: [], existing: [], invalid: [] }, invalid));
        return;
      }
      try {
        const r = await createLinks(
          parentId,
          urls.map((url) => ({ url })),
        );
        say(linksSummary(r, invalid));
        created(r.created.map((e) => e.id));
        changed();
      } catch (e) {
        if (!isUnauthorized(e)) toast(errorMessage(e, 'Не удалось добавить ссылку'), 'error');
      }
    },
    [say, created, changed, toast],
  );

  /** Текст буфера или переноса: по строке на адрес. */
  const addFromText = useCallback(
    (text: string, parentId: number | null): Promise<void> => {
      const { urls, invalid } = parseUrlList(text);
      return addLinks(urls, parentId, invalid);
    },
    [addLinks],
  );

  /** HTML-экспорт закладок: пачками по LINK_BATCH, итог - одним тостом. */
  const importBookmarks = useCallback(
    async (file: File, parentId: number | null): Promise<void> => {
      let html: string;
      try {
        html = await readFileText(file);
      } catch {
        toast('Не удалось прочитать файл закладок', 'error');
        return;
      }
      const { links, skipped } = parseBookmarks(html);
      const totals: BookmarksTotals = { created: 0, existing: 0, invalid: skipped };
      if (links.length > LINK_BATCH) toast(`Импорт закладок: ${links.length}…`, 'info');

      let failed = false;
      try {
        for (const batch of chunk(links, LINK_BATCH)) {
          const r = await createLinks(parentId, batch);
          totals.created += r.created.length;
          totals.existing += r.existing.length;
          totals.invalid += r.invalid.length;
          activity(); // долгий импорт = присутствие (UF-13)
        }
      } catch (e) {
        if (isUnauthorized(e)) return;
        failed = true;
        toast(errorMessage(e, 'Не удалось импортировать закладки'), 'error');
      }
      if (!failed || totals.created + totals.existing > 0) {
        const summary = bookmarksSummary(totals);
        toast(summary.text, summary.kind);
      }
      changed(); // часть закладок могла создаться до ошибки
    },
    [toast, activity, changed],
  );

  return { addLinks, addFromText, importBookmarks };
}
