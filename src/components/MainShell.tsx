import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent, MouseEvent } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  attachmentsZipUrlOf,
  deleteEntries,
  downloadUrlOf,
  lockSafe,
  refreshPreview,
  updateEntry,
} from '../api/endpoints';
import type { PendingFile } from '../api/endpoints';
import { ApiRequestError, errorMessage, isUnauthorized } from '../api/client';
import { entryQuery, invalidateContent, listingQuery, searchQuery, statusQuery } from '../api/queries';
import type { Entry, EntryPatch } from '../api/types';
import {
  copyText,
  isInteractiveTarget,
  isTypingTarget,
  triggerDownload,
  triggerDownloads,
} from '../lib/dom';
import { dragKind, filesFromDataTransfer, linkTextFromDataTransfer, pastedFile } from '../lib/dnd';
import { deleteWarning, firstLine, plural } from '../lib/format';
import { displayName } from '../lib/link';
import type { MenuAction } from '../lib/menu';
import { isNavKey } from '../lib/selection';
import { EMPTY_FILTER, filterSummary, isFilterActive, pruneFilterTags, searchOptionsFor } from '../lib/tagFilter';
import type { TagFilter } from '../lib/tagFilter';
import { pathNames } from '../lib/tags';
import { folderAfterDelete } from '../lib/tree';
import { planSuffixRename } from '../lib/uniqueNames';
import type { NameChange } from '../lib/uniqueNames';
import { useConflictPrompt } from '../hooks/useConflictPrompt';
import { useEntryDnd } from '../hooks/useEntryDnd';
import { useEvent, useWindowEvent } from '../hooks/useEvent';
import { useHeartbeat } from '../hooks/useHeartbeat';
import { useImporter } from '../hooks/useImporter';
import { useLinks } from '../hooks/useLinks';
import { useMoveEntries } from '../hooks/useMoveEntries';
import { useRubberBand } from '../hooks/useRubberBand';
import { useSelection } from '../hooks/useSelection';
import { TagCatalogProvider, useTagCatalog } from '../hooks/useTagCatalog';
import { bumpThumbnail } from '../hooks/useThumbnailSrc';
import { useWatchFolder } from '../hooks/useWatchFolder';
import { ConfirmDialog } from './ConfirmDialog';
import type { ConfirmRequest } from './ConfirmDialog';
import { ContextMenu } from './ContextMenu';
import type { ContextMenuState } from './ContextMenu';
import type { EntryCardHandlers } from './EntryCard';
import { FolderTree } from './FolderTree';
import { Gallery } from './Gallery';
import type { DisplayItem } from './Gallery';
import { IdleWarning } from './IdleWarning';
import { ImportPanel } from './ImportPanel';
import { LinkConfirm } from './LinkConfirm';
import { Lightbox } from './Lightbox';
import { anyModalOpen } from './Modal';
import { MoveDialog } from './MoveDialog';
import { PropertiesPanel } from './PropertiesPanel';
import type { PropertiesTarget } from './PropertiesPanel';
import { SelectionBar } from './SelectionBar';
import { StatusBar } from './StatusBar';
import { FilterPanel } from './TagFilter';
import { TagSidebar } from './TagSidebar';
import { TagsScreen } from './TagsScreen';
import { TopBar } from './TopBar';
import { useToast } from './Toasts';
import { VideoModal } from './VideoModal';

const SEARCH_DEBOUNCE_MS = 240; // UF-8
const FRESH_MS = 3000; // сколько подсвечена новая ссылка
const NO_FRESH: ReadonlySet<number> = new Set();

type Viewer =
  | { kind: 'photos'; photos: Entry[]; index: number }
  | { kind: 'video'; entry: Entry }
  | { kind: 'link'; entry: Entry };

/** Главное окно: слева дерево и свойства записи, сверху крошки и поиск, в центре
 * сетка карточек, справа - панель фильтра по тегам. */
export function MainShell({ onLocked }: { onLocked: () => void }) {
  return (
    <TagCatalogProvider>
      <Shell onLocked={onLocked} />
    </TagCatalogProvider>
  );
}

function Shell({ onLocked }: { onLocked: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { idleWarningSec, markActivity, stay } = useHeartbeat();

  // ── Навигация и поиск ─────────────────────────────────────────────────────

  const [folderId, setFolderId] = useState<number | null>(null);
  const [searchText, setSearchText] = useState('');
  const [committedQuery, setCommittedQuery] = useState('');

  // дебаунс ~240 мс; пустой запрос возвращает в папку сразу
  useEffect(() => {
    const q = searchText.trim();
    if (q === '') {
      setCommittedQuery('');
      return;
    }
    const t = setTimeout(() => setCommittedQuery(q), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchText]);

  const isSearch = committedQuery !== '' && searchText.trim() !== '';

  // фильтр по тегам (UF-18): результаты показываем тем же видом, что и поиск
  const catalog = useTagCatalog();
  const [filter, setFilter] = useState<TagFilter>(EMPTY_FILTER);
  const isFilter = isFilterActive(filter);
  const showResults = isSearch || isFilter;
  const [filterOpen, setFilterOpen] = useState(false); // панель фильтра справа
  const [tagsOpen, setTagsOpen] = useState(false);

  // тег удалили или слили - из фильтра он уходит (сервер на неизвестный id отвечает 422)
  useEffect(() => setFilter((f) => pruneFilterTags(f, catalog)), [catalog]);

  // ── Данные ────────────────────────────────────────────────────────────────

  const status = useQuery(statusQuery);
  const safe = status.data?.safe;

  useEffect(() => {
    // токен умер (блокировка в другой вкладке и т.п.) — на экран входа
    if (status.data !== undefined && !status.data.authorized) onLocked();
  }, [status.data, onLocked]);

  // «в этой папке» - within открытой папки или записи; без тегов параметров нет
  const filterOptions = useMemo(() => searchOptionsFor(filter, folderId), [filter, folderId]);
  const listing = useQuery({
    ...listingQuery(folderId),
    enabled: !showResults,
    placeholderData: keepPreviousData,
  });
  const search = useQuery({
    ...searchQuery(isSearch ? committedQuery : '', filterOptions),
    enabled: showResults,
    placeholderData: keepPreviousData,
  });

  // крошки открытой папки (для «удалили открытую папку — на родителя»)
  const folderPath = listing.isPlaceholderData ? undefined : listing.data?.path;
  const expandPath = useMemo(() => folderPath?.map((p) => p.id), [folderPath]);

  const baseItems = useMemo<DisplayItem[]>(() => {
    if (!showResults) return (listing.data?.entries ?? []).map((entry) => ({ entry }));
    return (search.data?.results ?? []).map((h) => ({
      entry: h.entry,
      caption: h.path.length > 0 ? h.path.map((p) => p.name).join(' / ') : 'Все объекты',
      matchedIn: h.matchedIn,
      // в результатах видна и первая строка описания: «где слово» видно сразу
      // (у ссылки описание уже есть на карточке - не дублируем)
      snippet:
        h.entry.kind !== 'link' && h.entry.description !== '' ? firstLine(h.entry.description) : undefined,
    }));
  }, [showResults, listing.data, search.data]);

  // только что добавленные ссылки подсвечены пару секунд (UF-20)
  const [fresh, setFresh] = useState<ReadonlySet<number>>(NO_FRESH);
  const items = useMemo<DisplayItem[]>(
    () => (fresh.size === 0 ? baseItems : baseItems.map((d) => ({ ...d, fresh: fresh.has(d.entry.id) }))),
    [baseItems, fresh],
  );

  const entries = useMemo(() => baseItems.map((d) => d.entry), [baseItems]);
  const visibleIds = useMemo(() => entries.map((e) => e.id), [entries]);
  const selection = useSelection(visibleIds);
  const { clear: clearSelection, toggle: toggleSelect, replace: replaceSelection } = selection; // стабильные

  const refreshContent = useCallback(() => invalidateContent(qc), [qc]);

  // ── Рамка выделения (UF-9, «как в проводнике») ────────────────────────────

  const mainRef = useRef<HTMLElement>(null);
  const selectedRef = useRef(selection.selected);
  selectedRef.current = selection.selected;
  const rubberCards = useCallback(
    () =>
      Array.from(mainRef.current?.querySelectorAll<HTMLElement>('[data-entry-id]') ?? []).map((el) => ({
        id: Number(el.dataset.entryId),
        el,
      })),
    [],
  );
  const rubber = useRubberBand({
    // тот же «фон», что у клика-сброса: сам main и сетка между карточками
    isBackground: (e) => {
      const t = e.target as HTMLElement;
      return t === e.currentTarget || t.dataset.gallery !== undefined;
    },
    getCards: rubberCards,
    getBase: () => selectedRef.current,
    onSelect: replaceSelection,
    getViewport: () => mainRef.current, // автоскролл у кромок при протяжке
  });

  // ── Состояние окна ────────────────────────────────────────────────────────

  const [renamingId, setRenamingId] = useState<number | null>(null);
  const hoveredId = useRef<number | null>(null); // только для F2 — без перерисовок
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [propsOpen, setPropsOpen] = useState(false);
  const [moveTargets, setMoveTargets] = useState<Entry[] | null>(null);
  const [focusTagsFor, setFocusTagsFor] = useState<number | null>(null); // «Теги…» из меню: поле ввода в панели
  const [reveal, setReveal] = useState<number | null>(null); // запись-источник тега: показать после перехода
  const [dragging, setDragging] = useState<'files' | 'link' | null>(null); // что тащат над окном
  const dragDepth = useRef(0);

  const navigate = useCallback(
    (id: number | null) => {
      setFolderId(id);
      setSearchText('');
      setCommittedQuery('');
      setFilter((f) => (isFilterActive(f) ? { ...f, tags: [] } : f)); // клик по папке сбрасывает и фильтр
      setTagsOpen(false);
      setRenamingId(null);
      clearSelection();
    },
    [clearSelection],
  );

  // открытую папку удалили в другой вкладке/через поиск — в корень
  useEffect(() => {
    const e = listing.error;
    if (folderId !== null && e instanceof ApiRequestError && (e.status === 404 || e.status === 422)) {
      toast('Открытая папка или запись больше не существует', 'info');
      navigate(null);
    }
  }, [listing.error, folderId, navigate, toast]);

  // ── Импорт ────────────────────────────────────────────────────────────────

  // один диалог «имя занято» на импорт и перемещение (UF-14, UF-15)
  const conflicts = useConflictPrompt();

  const importer = useImporter({
    onBatchDone: refreshContent,
    onActivity: markActivity,
    askConflicts: conflicts.ask,
  });
  const { enqueue } = importer;

  const importFiles = useCallback(
    (files: PendingFile[], source?: string) => enqueue(files, folderId, source),
    [enqueue, folderId],
  );

  const watch = useWatchFolder((found, folderName) => {
    void (async () => {
      try {
        const files = await Promise.all(found.map((e) => e.getFile()));
        importFiles(files, folderName);
      } catch {
        // файл исчез между опросом и чтением — следующий опрос разберётся
      }
    })();
  });

  // ── Действия ──────────────────────────────────────────────────────────────

  const openEntry = useEvent((entry: Entry) => {
    switch (entry.kind) {
      case 'folder':
        navigate(entry.id);
        break;
      case 'photo': {
        const photos = entries.filter((e) => e.kind === 'photo');
        const index = Math.max(0, photos.findIndex((e) => e.id === entry.id));
        setViewer({ kind: 'photos', photos, index });
        break;
      }
      case 'video':
        setViewer({ kind: 'video', entry });
        break;
      case 'link':
        setViewer({ kind: 'link', entry });
        break;
      default: {
        const url = downloadUrlOf(entry);
        if (url !== null) triggerDownload(url);
      }
    }
  });

  const downloadEntry = useCallback((entry: Entry) => {
    const url = downloadUrlOf(entry);
    if (url !== null) triggerDownload(url);
  }, []);

  const selectedEntries = useMemo(
    () => entries.filter((e) => selection.selected.has(e.id)),
    [entries, selection.selected],
  );
  const selectionUrls = useMemo(
    () => selectedEntries.map(downloadUrlOf).filter((u): u is string => u !== null),
    [selectedEntries],
  );

  const deleteMut = useMutation({
    mutationFn: (ids: number[]) => deleteEntries(ids),
    onSuccess: (r, ids) => {
      toast(`Удалено: ${plural(r.removed, 'объект', 'объекта', 'объектов')}`, 'success');
      clearSelection();
      // UF-10: удалённая открытая папка (или её предок) возвращает на родителя;
      // в режиме поиска меняем только папку «под» поиском, результаты не сбрасываем
      const back = folderPath === undefined ? undefined : folderAfterDelete(folderPath, new Set(ids));
      if (back !== undefined) {
        if (showResults) setFolderId(back);
        else navigate(back);
      }
      refreshContent();
    },
    onError: (e) => {
      if (!isUnauthorized(e)) toast(errorMessage(e, 'Не удалось удалить'), 'error');
      refreshContent(); // часть могла удалиться до ошибки
    },
  });

  const requestDelete = useEvent((ids: number[]) => {
    if (ids.length === 0) return;
    const doomed = entries.filter((e) => ids.includes(e.id));
    const [single] = doomed;
    setConfirm({
      title:
        doomed.length === 1 && single !== undefined
          ? `Удалить «${displayName(single)}»?`
          : `Удалить ${plural(ids.length, 'объект', 'объекта', 'объектов')}?`,
      message: `${deleteWarning(doomed)}Восстановить удалённое нельзя.`,
      confirmLabel: 'Удалить',
      danger: true,
      onConfirm: () => deleteMut.mutate(ids),
    });
  });

  const commitRename = useEvent(async (id: number, name: string) => {
    setRenamingId(null);
    const current = entries.find((e) => e.id === id);
    if (current === undefined || current.name === name) return;
    try {
      await updateEntry(id, { name });
      refreshContent();
    } catch (e) {
      if (!isUnauthorized(e)) toast(errorMessage(e, 'Не удалось переименовать'), 'error');
    }
  });

  // ── Приписки одинаковым именам, «как в проводнике» ────────────────────────

  const applyUniqueNames = useEvent(async (changes: NameChange[]) => {
    let done = 0;
    for (const c of changes) {
      try {
        await updateEntry(c.id, { name: c.to });
        done += 1;
      } catch (e) {
        if (isUnauthorized(e)) return; // экран входа
        toast(errorMessage(e, `Не удалось переименовать «${c.from}»`), 'error');
        break; // не ломаем имена дальше по списку на полпути
      }
    }
    if (done > 0) toast(`Переименовано: ${plural(done, 'запись', 'записи', 'записей')}`, 'success');
    refreshContent();
  });

  const askUniqueNames = useEvent(() => {
    // занятые имена - всё содержимое текущего вида, чтобы приписка ни с кем не столкнулась
    const changes = planSuffixRename(selectedEntries, entries);
    if (changes.length === 0) {
      toast('Среди выделенных нет одинаковых имён', 'info');
      return;
    }
    const preview = changes
      .slice(0, 8)
      .map((c) => `${c.from} → ${c.to}`)
      .join('\n');
    setConfirm({
      title: `Различить имена: ${plural(changes.length, 'запись', 'записи', 'записей')}?`,
      message:
        `Одинаковым именам добавятся приписки, как в проводнике:\n${preview}` +
        (changes.length > 8 ? `\n… и ещё ${changes.length - 8}` : ''),
      confirmLabel: 'Переименовать',
      onConfirm: () => void applyUniqueNames(changes),
    });
  });

  const lock = useEvent(async () => {
    setViewer(null); // закрыть видео: его Range-поток держит аренду сессии
    importer.cancelAll();
    try {
      await lockSafe();
    } catch {
      // сессия уже мертва или сервер недоступен — без пульса он сам заблокирует сейф
    }
    onLocked();
  });

  // ── Перемещение и вложения (UF-14) ────────────────────────────────────────

  const moveEntriesTo = useMoveEntries({
    askConflicts: conflicts.ask,
    onDone: (moved) => {
      if (moved) clearSelection();
      refreshContent();
    },
  });

  const dnd = useEntryDnd({ entries, selected: selection.selected, onMove: (m, p) => void moveEntriesTo(m, p) });

  // ── Свойства (UF-22) ──────────────────────────────────────────────────────

  // нет выделения - свойства открытой папки (или вложений записи), в поиске и корне - пусто
  const container = showResults || listing.isPlaceholderData ? null : (listing.data?.parent ?? null);
  const propsTarget = useMemo<PropertiesTarget>(
    () =>
      selectedEntries.length > 0
        ? { entries: selectedEntries, scope: 'selection' }
        : { entries: container === null ? [] : [container], scope: 'container' },
    [selectedEntries, container],
  );
  const shownId = useRef<number | null>(null); // чьи свойства на экране: куда попадёт ошибка поля
  shownId.current = propsTarget.entries.length === 1 ? (propsTarget.entries[0]?.id ?? null) : null;

  const saveProperties = useEvent(async (id: number, patch: EntryPatch) => {
    try {
      await updateEntry(id, patch);
      refreshContent();
    } catch (e) {
      if (isUnauthorized(e)) return; // экран входа
      // панель уже показывает другую запись: поля с ошибкой больше нет, скажем тостом
      if (shownId.current !== id) toast(errorMessage(e, 'Не удалось сохранить'), 'error');
      throw e;
    }
  });

  // id - запись, свойства которой нужны; null - те, что уже выделены (или открытая папка)
  const openProperties = useEvent((id: number | null) => {
    if (id !== null) selection.only(id);
    setPropsOpen(true);
  });

  // «+N» тегов на карточке: свойства записи с фокусом в поле тегов
  const openCardTags = useEvent((entry: Entry) => {
    openProperties(entry.id);
    setFocusTagsFor(entry.id);
  });

  // ── Теги (UF-16, UF-17, UF-18) ────────────────────────────────────────────

  // имена предков из крошек листинга и результатов: «от: <имя>» у унаследованных тегов
  const sourceNames = useMemo(
    () => pathNames([...(listing.data ? [listing.data.path] : []), ...(search.data?.results.map((h) => h.path) ?? [])]),
    [listing.data, search.data],
  );

  // клик по унаследованному тегу: перейти к записи, от которой он, и выделить её
  const openSource = useEvent(async (id: number) => {
    try {
      const source = await qc.fetchQuery({ ...entryQuery(id), staleTime: 0 });
      navigate(source.parentId);
      setReveal(source.id);
    } catch (e) {
      if (!isUnauthorized(e)) toast(errorMessage(e, 'Не удалось открыть запись'), 'error');
    }
  });

  const { only: selectOnly } = selection;
  useEffect(() => {
    if (reveal === null || showResults || listing.isPlaceholderData || listing.data === undefined) return;
    if (listing.data.entries.some((e) => e.id === reveal)) {
      selectOnly(reveal);
      setPropsOpen(true);
    }
    setReveal(null);
  }, [reveal, showResults, listing.isPlaceholderData, listing.data, selectOnly]);

  // теги/описание изменились - обновляем и снимки в открытом просмотрщике,
  // чтобы панель слева показывала свежие теги (сами карточки обновляет запрос)
  useEffect(() => {
    const byId = new Map(entries.map((e) => [e.id, e]));
    setViewer((v) => {
      if (v === null) return v;
      if (v.kind !== 'photos') {
        const fresh = byId.get(v.entry.id);
        return fresh !== undefined && fresh !== v.entry ? { ...v, entry: fresh } : v;
      }
      const photos = v.photos.map((p) => byId.get(p.id) ?? p);
      if (photos.every((p, i) => p === v.photos[i])) return v;
      const current = v.photos[v.index]?.id;
      const index = Math.max(0, photos.findIndex((p) => p.id === current));
      return { ...v, photos, index };
    });
  }, [entries]);

  // ── Создание ссылок (UF-20) ───────────────────────────────────────────────

  const freshTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(freshTimer.current), []);

  const links = useLinks({
    onChanged: refreshContent,
    onCreated: (ids) => {
      clearTimeout(freshTimer.current);
      setFresh(new Set(ids));
      freshTimer.current = setTimeout(() => setFresh(NO_FRESH), FRESH_MS);
    },
    onShow: (id) => void openSource(id), // «Уже есть» -> «Показать»
    onActivity: markActivity,
  });

  const changeFilter = useEvent((next: TagFilter) => {
    setFilter(next);
    setTagsOpen(false);
    setRenamingId(null);
  });

  // клик по тегу на экране «Теги», чипу карточки или панели свойств: фильтр по
  // нему на весь сейф; панель фильтра открывается - видно, что выбрано
  const filterByTag = useEvent((tagId: number) => {
    setFilter((f) => ({ ...f, tags: [tagId], scope: 'vault' }));
    setSearchText('');
    setCommittedQuery('');
    setTagsOpen(false);
    setRenamingId(null);
    setFilterOpen(true);
  });

  // тег в каталоге слева: добавить в фильтр или убрать (можно несколько)
  const toggleFilterTag = useEvent((next: TagFilter) => {
    setFilter(next);
    setSearchText('');
    setCommittedQuery('');
    setRenamingId(null);
    setFilterOpen(true);
  });

  // ── Ссылки (UF-6) ─────────────────────────────────────────────────────────

  const copyLink = useEvent(async (entry: Entry) => {
    const ok = entry.url !== undefined && (await copyText(entry.url));
    toast(ok ? 'Адрес скопирован' : 'Не удалось скопировать адрес', ok ? 'success' : 'error');
  });

  const refreshLinkPreview = useEvent(async (entry: Entry) => {
    toast('Загружаем предпросмотр…', 'info');
    try {
      await refreshPreview(entry.id);
      bumpThumbnail(entry.id);
      toast('Предпросмотр обновлён', 'success');
      refreshContent();
    } catch (e) {
      // 502: причина (сайт недоступен, нет метаданных, таймаут) - в message сервера
      if (!isUnauthorized(e)) toast(errorMessage(e, 'Не удалось обновить предпросмотр'), 'error');
    }
  });

  const runMenuAction = useEvent((action: MenuAction, entry: Entry) => {
    switch (action) {
      case 'open':
        openEntry(entry);
        break;
      case 'openAttachments':
        navigate(entry.id);
        break;
      case 'download':
        downloadEntry(entry);
        break;
      case 'downloadAttachments': {
        const url = attachmentsZipUrlOf(entry);
        if (url !== null) triggerDownload(url);
        break;
      }
      case 'copyLink':
        void copyLink(entry);
        break;
      case 'refreshPreview':
        void refreshLinkPreview(entry);
        break;
      case 'properties':
        openProperties(entry.id);
        break;
      case 'rename':
        setRenamingId(entry.id);
        break;
      case 'move':
        setMoveTargets([entry]);
        break;
      case 'tags':
        openProperties(entry.id);
        setFocusTagsFor(entry.id);
        break;
      case 'delete':
        requestDelete([entry.id]);
        break;
    }
  });

  // ── Карточки ──────────────────────────────────────────────────────────────

  const onCardClick = useEvent((e: MouseEvent, entry: Entry) => {
    if (e.ctrlKey || e.metaKey) selection.toggle(entry.id);
    else if (e.shiftKey) selection.extendTo(entry.id);
    else openEntry(entry);
  });

  const onCardContextMenu = useEvent((e: MouseEvent, entry: Entry) => {
    e.preventDefault();
    if (!selection.selected.has(entry.id)) selection.only(entry.id);
    setMenu({ x: e.clientX, y: e.clientY, entry });
  });

  // стабильный объект: memo-карточки перерисовываются только при смене своих props
  const cardHandlers = useMemo<EntryCardHandlers>(
    () => ({
      onClick: onCardClick,
      onToggleSelect: toggleSelect,
      onContextMenu: onCardContextMenu,
      onRenameStart: setRenamingId,
      onRenameCommit: (id: number, name: string) => void commitRename(id, name),
      onRenameCancel: () => setRenamingId(null),
      onHover: (id: number | null) => {
        hoveredId.current = id;
      },
      onDropLink: (entry: Entry, dt: DataTransfer) =>
        void links.addFromText(linkTextFromDataTransfer(dt), entry.id), // станет вложением записи
      onTagClick: filterByTag, // чип тега на карточке - фильтр по нему
      onOpenTags: openCardTags, // «+N» тегов - свойства с фокусом в поле тегов
      ...dnd.card,
    }),
    [onCardClick, toggleSelect, onCardContextMenu, commitRename, dnd.card, links.addFromText, filterByTag, openCardTags],
  );

  // ── Клавиатура ────────────────────────────────────────────────────────────

  useWindowEvent('keydown', (e) => {
    if (e.defaultPrevented || isTypingTarget(e.target) || anyModalOpen() || menu !== null || tagsOpen) return;
    const { selected } = selection;
    const [first] = selected;
    const ctrl = e.ctrlKey || e.metaKey;

    if (e.key === 'Escape') {
      // сверху лежат панели: сначала закрываем их, потом снимаем выделение
      if (propsOpen) setPropsOpen(false);
      else if (selected.size > 0) selection.clear();
      else if (filterOpen) setFilterOpen(false);
      else if (isSearch) setSearchText('');
      else if (isFilter) setFilter((f) => ({ ...f, tags: [] }));
    } else if (e.key === 'F2') {
      const target = selected.size === 1 && first !== undefined ? first : hoveredId.current;
      if (target !== null) {
        e.preventDefault();
        setRenamingId(target);
      }
    } else if (e.key === 'Delete') {
      if (selected.size > 0) {
        e.preventDefault();
        requestDelete([...selected]);
      }
    } else if (e.key === 'Enter' && e.altKey) {
      // Alt+Enter: свойства выделенной (или той, над которой курсор) записи
      e.preventDefault();
      openProperties(selected.size === 0 ? hoveredId.current : null);
    } else if (e.key === 'Enter') {
      if (isInteractiveTarget(e.target) || selected.size !== 1) return;
      const entry = entries.find((en) => en.id === first);
      if (entry !== undefined) openEntry(entry);
    } else if (ctrl && (e.key.toLowerCase() === 'a' || e.code === 'KeyA')) {
      // e.code - физическая клавиша: Ctrl+A работает и на русской раскладке (e.key = «ф»)
      e.preventDefault();
      selection.selectAll();
    } else if (!ctrl && isNavKey(e.key)) {
      e.preventDefault();
      selection.move(e.key);
    }
  });

  // ── Вставка из буфера (Ctrl+V): файлы/картинки и ссылки ──────────────────

  useWindowEvent('paste', (e) => {
    if (isTypingTarget(e.target) || anyModalOpen() || tagsOpen) return; // в полях вставка обычная
    const cd = e.clipboardData;
    if (cd === null) return;
    if (cd.files.length > 0) {
      e.preventDefault();
      // скопированная в браузере картинка или файл из проводника
      importFiles(Array.from(cd.files).map(pastedFile));
      return;
    }
    const text = cd.getData('text');
    if (text.trim() === '') return;
    e.preventDefault();
    void links.addFromText(text, folderId); // по строке на адрес
  });

  // ── Drag&drop ─────────────────────────────────────────────────────────────

  // Окно берёт файлы из проводника и ссылки/текст из браузера; перенос карточек
  // обрабатывают их приёмники. Текст, брошенный в поле ввода, окну не нужен.
  const droppedKind = (e: DragEvent): 'files' | 'link' | null => {
    const kind = dragKind(e.dataTransfer.types);
    if (kind === 'files') return kind;
    return kind === 'link' && !isTypingTarget(e.target) && !anyModalOpen() ? kind : null;
  };
  const dropHandlers = {
    onDragEnter: (e: DragEvent) => {
      const kind = droppedKind(e);
      if (kind === null) return;
      dragDepth.current += 1;
      setDragging(kind);
    },
    onDragOver: (e: DragEvent) => {
      if (droppedKind(e) !== null) e.preventDefault();
    },
    onDragLeave: (e: DragEvent) => {
      if (droppedKind(e) === null) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(null);
    },
    onDrop: (e: DragEvent) => {
      const kind = droppedKind(e);
      if (kind === null) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(null);
      if (kind === 'files') void filesFromDataTransfer(e.dataTransfer).then((files) => importFiles(files));
      else void links.addFromText(linkTextFromDataTransfer(e.dataTransfer), folderId);
    },
  };

  // ── Экраны ────────────────────────────────────────────────────────────────

  if (status.isPending) {
    return (
      <div className="flex h-screen items-center justify-center" aria-busy="true">
        <span className="h-10 w-10 animate-spin rounded-full border-2 border-zinc-700 border-t-accent" />
      </div>
    );
  }

  if (status.data === undefined) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 text-center">
        <p className="text-sm text-zinc-300">Нет соединения с сервером safeboxd.</p>
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded-lg bg-accent px-4 py-1.5 text-sm text-white hover:bg-accent-hover"
            onClick={() => void status.refetch()}
          >
            Повторить
          </button>
          <button
            type="button"
            className="rounded-lg border border-zinc-700 px-4 py-1.5 text-sm text-zinc-300 hover:border-zinc-500"
            onClick={onLocked}
          >
            К экрану входа
          </button>
        </div>
      </div>
    );
  }

  const contentError = (showResults ? search.error : listing.error) ?? null;
  const loading = showResults ? search.isPending : listing.isPending;

  return (
    <div className="flex h-screen flex-col" {...dropHandlers}>
      <TopBar
        path={showResults ? null : (listing.data?.path ?? [])}
        searchQuery={committedQuery}
        searchActive={isSearch}
        searchText={searchText}
        onSearchText={(text) => {
          setSearchText(text);
          if (text !== '') setTagsOpen(false);
        }}
        filter={filter}
        filterSummary={isFilter ? filterSummary(filter, catalog, folderId) : null}
        filterOpen={filterOpen}
        onToggleFilter={() => setFilterOpen((open) => !open)}
        onFilterChange={changeFilter}
        tagsOpen={tagsOpen}
        onToggleTags={() => setTagsOpen((open) => !open)}
        onNavigate={navigate}
        onImportFiles={(files) => importFiles(files)}
        onWatchFolder={() => void watch.enable()}
        onAddLink={(url) => void links.addLinks([url], folderId)}
        onImportBookmarks={(file) => void links.importBookmarks(file, folderId)}
        onLock={() => void lock()}
        safe={safe}
      />

      <div className="flex min-h-0 flex-1">
        <aside className="w-60 shrink-0 overflow-y-auto border-r border-zinc-800 py-3">
          <p className="px-4 pb-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-600">
            Папки
          </p>
          <FolderTree
            current={showResults ? undefined : folderId}
            expandPath={expandPath}
            onNavigate={navigate}
            dnd={dnd.tree}
          />
          <TagSidebar
            filter={filter}
            onToggleTag={toggleFilterTag}
            onManage={() => setTagsOpen(true)}
          />
        </aside>

        {propsOpen && (
          <PropertiesPanel
            target={propsTarget}
            onSave={saveProperties}
            onClose={() => setPropsOpen(false)}
            sourceNames={sourceNames}
            onOpenSource={(id) => void openSource(id)}
            onFilterTag={filterByTag}
            focusTagsFor={focusTagsFor}
            onTagsFocused={() => setFocusTagsFor(null)}
          />
        )}

        <main
          ref={mainRef}
          className={`flex-1 overflow-y-auto p-4 pb-20 ${rubber.box !== null ? 'select-none' : ''}`}
          onPointerDown={rubber.onPointerDown}
          onClick={(e) => {
            if (rubber.justCommitted.current) {
              rubber.justCommitted.current = false; // это отпустили рамку, а не кликнули по фону
              return;
            }
            const t = e.target as HTMLElement;
            if (t === e.currentTarget || t.dataset.gallery !== undefined) clearSelection();
          }}
        >
          {contentError !== null ? (
            <div className="flex h-64 flex-col items-center justify-center gap-3">
              <p className="text-sm text-zinc-300">{contentError.message}</p>
              <button
                type="button"
                className="rounded-lg bg-accent px-4 py-1.5 text-sm text-white hover:bg-accent-hover"
                onClick={() => navigate(null)}
              >
                К корню
              </button>
            </div>
          ) : (
            <Gallery
              items={items}
              loading={loading}
              isSearch={showResults}
              selection={selection.selected}
              renamingId={renamingId}
              handlers={cardHandlers}
            />
          )}
        </main>

        {filterOpen && (
          <FilterPanel
            filter={filter}
            canScopeFolder={folderId !== null}
            onChange={changeFilter}
            onClose={() => setFilterOpen(false)}
          />
        )}
      </div>

      <StatusBar
        safe={safe}
        isSearch={showResults}
        found={entries.length}
        watch={{ status: watch.status, folderName: watch.folderName }}
        onWatchResume={() => void watch.resume()}
        onWatchDisable={() => void watch.disable()}
      />

      {rubber.box !== null && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed z-40 rounded-sm border border-accent/80 bg-accent/10"
          style={{
            left: rubber.box.left,
            top: rubber.box.top,
            width: rubber.box.width,
            height: rubber.box.height,
          }}
        />
      )}

      {tagsOpen && <TagsScreen onBack={() => setTagsOpen(false)} onFilter={filterByTag} />}

      {selection.selected.size > 0 && !tagsOpen && (
        <SelectionBar
          entries={selectedEntries}
          count={selection.selected.size}
          canDownload={selectionUrls.length > 0}
          onDownload={() => triggerDownloads(selectionUrls)}
          onRename={() => {
            const [id] = selection.selected;
            if (id !== undefined) setRenamingId(id);
          }}
          onUniqueNames={askUniqueNames}
          onMove={() => setMoveTargets(selectedEntries)}
          onProperties={() => openProperties(null)}
          onDelete={() => requestDelete([...selection.selected])}
          onClear={clearSelection}
        />
      )}

      {importer.progress !== null && <ImportPanel progress={importer.progress} />}

      {menu !== null && (
        <ContextMenu
          state={menu}
          onClose={() => setMenu(null)}
          onAction={runMenuAction}
        />
      )}

      {viewer?.kind === 'photos' && (
        <Lightbox
          photos={viewer.photos}
          index={viewer.index}
          onIndex={(index) => setViewer({ ...viewer, index })}
          onClose={() => setViewer(null)}
          onActivity={markActivity}
          sourceNames={sourceNames}
          onOpenSource={(id) => {
            setViewer(null);
            void openSource(id);
          }}
          onFilterTag={(tagId) => {
            setViewer(null);
            filterByTag(tagId);
          }}
          onSavePatch={saveProperties}
        />
      )}
      {viewer?.kind === 'video' && (
        <VideoModal
          entry={viewer.entry}
          onClose={() => setViewer(null)}
          onActivity={markActivity}
          sourceNames={sourceNames}
          onOpenSource={(id) => {
            setViewer(null);
            void openSource(id);
          }}
          onFilterTag={(tagId) => {
            setViewer(null);
            filterByTag(tagId);
          }}
          onSavePatch={saveProperties}
        />
      )}
      {viewer?.kind === 'link' && <LinkConfirm entry={viewer.entry} onClose={() => setViewer(null)} />}

      {confirm !== null && <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />}

      {moveTargets !== null && (
        <MoveDialog
          entries={moveTargets}
          onMove={(parentId) => void moveEntriesTo(moveTargets, parentId)}
          onClose={() => setMoveTargets(null)}
        />
      )}

      {conflicts.element}

      {idleWarningSec !== null && <IdleWarning seconds={idleWarningSec} onStay={stay} />}

      {dragging !== null && (
        <div className="pointer-events-none fixed inset-0 z-[60] m-3 flex items-center justify-center rounded-2xl border-2 border-dashed border-accent bg-accent/10 backdrop-blur-[2px]">
          <p className="rounded-lg bg-zinc-900/90 px-6 py-3 text-sm text-zinc-100 shadow-xl">
            {dragging === 'files'
              ? 'Отпустите — файлы и папки импортируются в сейф'
              : 'Отпустите — ссылка добавится в эту папку; на карточку — во вложения записи'}
          </p>
        </div>
      )}
    </div>
  );
}
