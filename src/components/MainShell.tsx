import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent, MouseEvent } from 'react';
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  attachmentsZipUrlOf,
  createFolders,
  deleteEntries,
  downloadUrlOf,
  getEntry,
  lockSafe,
  moveEntries,
  refreshPreview,
  restoreFromTrash,
  updateEntry,
} from '../api/endpoints';
import type { PendingFile } from '../api/endpoints';
import { ApiRequestError, errorMessage, isUnauthorized } from '../api/client';
import {
  entryQuery,
  foldersQuery,
  invalidateContent,
  listingQuery,
  patchCachedEntries,
  searchQuery,
  statusQuery,
  trashCountQuery,
} from '../api/queries';
import type { Entry, EntryPatch } from '../api/types';
import {
  copyText,
  isInteractiveTarget,
  isTypingTarget,
  triggerDownload,
  triggerDownloads,
} from '../lib/dom';
import { dragKind, filesFromDataTransfer, linkTextFromDataTransfer, pastedFile } from '../lib/dnd';
import { foldForSearch } from '../lib/fold';
import { folderPaths } from '../lib/folderPaths';
import { firstLine, plural } from '../lib/format';
import { folderMenuItems } from '../lib/menu';
import type { FolderMenuAction, MenuAction } from '../lib/menu';
import { digitOfKey, isPlacesFull, placeAt, placeDigit, togglePlace as toggledPlaces } from '../lib/places';
import { isNavKey } from '../lib/selection';
import { EMPTY_FILTER, isFilterActive, pruneFilterTags, searchOptionsFor } from '../lib/tagFilter';
import type { TagFilter } from '../lib/tagFilter';
import { pathNames } from '../lib/tags';
import { isTable } from '../lib/table';
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
import { usePlaces } from '../hooks/usePlaces';
import { useRubberBand } from '../hooks/useRubberBand';
import { useAllPages, usePreviewPoll } from '../hooks/usePagedContent';
import { useSelection } from '../hooks/useSelection';
import { TagCatalogProvider, useTagCatalog } from '../hooks/useTagCatalog';
import { bumpThumbnail } from '../hooks/useThumbnailSrc';
import { useWatchFolder } from '../hooks/useWatchFolder';
import { ConfirmDialog } from './ConfirmDialog';
import type { ConfirmRequest } from './ConfirmDialog';
import { ContextMenu, MenuPopup } from './ContextMenu';
import type { ContextMenuState } from './ContextMenu';
import type { EntryCardHandlers } from './EntryCard';
import { FolderTree } from './FolderTree';
import { Gallery } from './Gallery';
import type { DisplayItem, GalleryHandle } from './Gallery';
import { IdleWarning } from './IdleWarning';
import { ImportPanel } from './ImportPanel';
import { LinkConfirm } from './LinkConfirm';
import { isViewable, MediaViewer } from './MediaViewer';
import type { PlaceChip } from './MediaViewer';
import { anyModalOpen } from './Modal';
import { MovePalette } from './MovePalette';
import { NameDialog } from './NameDialog';
import { NewTableDialog } from './NewTableDialog';
import { PropertiesPanel } from './PropertiesPanel';
import type { PropertiesTarget } from './PropertiesPanel';
import { SelectionBar } from './SelectionBar';
import { StatusBar } from './StatusBar';
import { TableView } from './TableView';
import type { TableViewHandle } from './TableView';
import { DockedWorkspace } from './PanelDock';
import { FilterBar } from './TagFilter';
import { TagsPanelActions, TagsPanelBody } from './TagsPanel';
import { TagsScreen } from './TagsScreen';
import { TopBar } from './TopBar';
import { useToast } from './Toasts';
import { restoreSummary, TrashView } from './TrashView';

const SEARCH_DEBOUNCE_MS = 240; // UF-8
const FRESH_MS = 3000; // сколько подсвечена новая ссылка
const NO_FRESH: ReadonlySet<number> = new Set();

/** Палитра «Переместить в…»: что перемещаем; done - ответ просмотрщику (перемещено ли). */
interface PaletteState {
  entries: Entry[];
  done?: (moved: boolean) => void;
}

/** Отмена перемещения: id записей по папкам, где они лежали. */
interface MoveUndo {
  groups: [number | null, number[]][];
}

type NameRequest =
  | { kind: 'create'; parentId: number | null; parentLabel: string }
  | { kind: 'rename'; id: number; name: string };

type Viewer =
  | { kind: 'media'; items: Entry[]; index: number } // фото, видео, ролики YouTube
  | { kind: 'link'; entry: Entry }
  | { kind: 'table'; entry: Entry }; // файл-таблица: открывается на весь экран

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
  const [tagsOpen, setTagsOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false); // вместо галереи - корзина

  // тег удалили или слили - из фильтра он уходит (сервер на неизвестный id отвечает 422)
  useEffect(() => setFilter((f) => pruneFilterTags(f, catalog)), [catalog]);

  // ── Данные ────────────────────────────────────────────────────────────────

  const status = useQuery(statusQuery);
  const safe = status.data?.safe;
  const trashCount = useQuery(trashCountQuery).data ?? 0;

  useEffect(() => {
    // токен умер (блокировка в другой вкладке и т.п.) — на экран входа
    if (status.data !== undefined && !status.data.authorized) onLocked();
  }, [status.data, onLocked]);

  // «в этой папке» - within открытой папки или записи; без тегов параметров нет
  const filterOptions = useMemo(() => searchOptionsFor(filter, folderId), [filter, folderId]);
  // К2: выдача страницами - первая сразу на экране, остальные догружаются подряд
  const listing = useInfiniteQuery({
    ...listingQuery(folderId),
    enabled: !showResults,
    placeholderData: keepPreviousData,
  });
  const search = useInfiniteQuery({
    ...searchQuery(isSearch ? committedQuery : '', filterOptions),
    enabled: showResults,
    placeholderData: keepPreviousData,
  });
  useAllPages(listing, !showResults);
  useAllPages(search, showResults);
  const content = showResults ? search : listing;
  const total = (showResults ? search.data?.total : listing.data?.total) ?? 0;
  const complete = (showResults ? search.data?.complete : listing.data?.complete) ?? true;

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
  usePreviewPoll(entries); // ссылки с предпросмотром в очереди - точечно, без перечитывания папки
  const selection = useSelection(visibleIds);
  const { clear: clearSelection, toggle: toggleSelect, replace: replaceSelection } = selection; // стабильные

  const refreshContent = useCallback(() => invalidateContent(qc), [qc]);

  // ── Рамка выделения (UF-9, «как в проводнике») ────────────────────────────

  const mainRef = useRef<HTMLElement>(null);
  const galleryRef = useRef<GalleryHandle | null>(null); // геометрия сетки: колонки, прокрутка, рамка
  const selectedRef = useRef(selection.selected);
  selectedRef.current = selection.selected;
  const rubber = useRubberBand({
    // тот же «фон», что у клика-сброса: сам main и сетка между карточками
    isBackground: (e) => {
      const t = e.target as HTMLElement;
      return t === e.currentTarget || t.dataset.gallery !== undefined;
    },
    getHits: (band) => galleryRef.current?.hitTest(band) ?? [],
    getBase: () => selectedRef.current,
    onSelect: replaceSelection,
    getViewport: () => mainRef.current, // автоскролл у кромок при протяжке
  });

  // ── Состояние окна ────────────────────────────────────────────────────────

  const [renamingId, setRenamingId] = useState<number | null>(null);
  const hoveredId = useRef<number | null>(null); // только для F2 — без перерисовок
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [newTable, setNewTable] = useState(false);
  const tableRef = useRef<TableViewHandle | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [propsOpen, setPropsOpen] = useState(false);
  const [palette, setPalette] = useState<PaletteState | null>(null);
  const [treeMenu, setTreeMenu] = useState<{ x: number; y: number; id: number | null } | null>(null);
  const [nameRequest, setNameRequest] = useState<NameRequest | null>(null);
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
      setTrashOpen(false);
      setRenamingId(null);
      setReveal(null); // «показать запись» из прошлой папки не срабатывает в новой
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

  // просмотрщик листает фото, видео, аудио, тексты и ролики текущего вида
  const viewMedia = useEvent((entry: Entry) => {
    const items = entries.filter(isViewable);
    const index = Math.max(0, items.findIndex((e) => e.id === entry.id));
    setViewer({ kind: 'media', items, index });
  });

  const openEntry = useEvent((entry: Entry) => {
    switch (entry.kind) {
      case 'folder':
        navigate(entry.id);
        break;
      case 'photo':
      case 'video':
        viewMedia(entry);
        break;
      case 'link':
        // ролик YouTube играет в просмотрщике, остальные ссылки - через подтверждение (UF-6)
        if (isViewable(entry)) viewMedia(entry);
        else setViewer({ kind: 'link', entry });
        break;
      default: {
        if (isTable(entry)) {
          setViewer({ kind: 'table', entry });
          break;
        }
        // аудио и текстовые файлы открываются в просмотрщике, прочие файлы скачиваются
        if (isViewable(entry)) {
          viewMedia(entry);
          break;
        }
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

  // просмотрщик: удалённое или перемещённое убрать из ленты, следующее - на место
  const dropFromViewer = useCallback((ids: readonly number[]) => {
    setViewer((v) => {
      if (v === null) return v;
      if (v.kind !== 'media') return ids.includes(v.entry.id) ? null : v;
      const gone = (p: Entry) => ids.includes(p.id);
      if (!v.items.some(gone)) return v;
      const items = v.items.filter((p) => !gone(p));
      if (items.length === 0) return null;
      // показываемое осталось - на нём; ушло - следующее уцелевшее после него (или последнее)
      const after = v.items.slice(v.index).find((p) => !gone(p));
      return { ...v, items, index: after === undefined ? items.length - 1 : items.indexOf(after) };
    });
  }, []);

  // последнее, что ушло в корзину: Ctrl+Z и «Отменить» в тосте возвращают
  const lastTrashed = useRef<number[] | null>(null);
  // последнее перемещение; Ctrl+Z отменяет то, что было позже - удаление или перемещение
  const lastMoved = useRef<MoveUndo | null>(null);
  const lastAction = useRef<'trash' | 'move' | null>(null);

  const restoreMut = useMutation({
    mutationFn: (ids: number[]) => restoreFromTrash(ids),
    onSuccess: (r) => {
      toast(restoreSummary(r.restored, r.renamed), 'success');
      refreshContent();
    },
    onError: (e) => {
      if (!isUnauthorized(e)) toast(errorMessage(e, 'Не удалось вернуть из корзины'), 'error');
      refreshContent();
    },
  });

  const undone = useRef(new WeakSet<number[]>()); // «Отменить» в тосте после Ctrl+Z - уже нечего
  const undoDelete = useEvent((ids?: number[]) => {
    const list = ids ?? lastTrashed.current;
    if (list === null || list.length === 0 || restoreMut.isPending || undone.current.has(list)) return;
    undone.current.add(list);
    const wasLast = lastTrashed.current === list;
    if (wasLast) lastTrashed.current = null;
    restoreMut.mutate(list, {
      onError: () => {
        // не вернулось - «Отменить» и Ctrl+Z можно повторить
        undone.current.delete(list);
        if (wasLast && lastTrashed.current === null) lastTrashed.current = list;
      },
    });
  });

  const deleteMut = useMutation({
    mutationFn: (ids: number[]) => deleteEntries(ids),
    onSuccess: (r, ids) => {
      lastTrashed.current = ids;
      lastAction.current = 'trash';
      toast(`В корзину: ${plural(r.removed, 'объект', 'объекта', 'объектов')}`, 'success', {
        label: 'Отменить',
        onClick: () => undoDelete(ids),
      });
      clearSelection();
      dropFromViewer(ids);
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

  // Ф4: удаление - в корзину без вопроса (вернуть: «Отменить», Ctrl+Z, экран «Корзина»)
  const requestDelete = useEvent((ids: number[]) => {
    if (ids.length === 0 || deleteMut.isPending) return;
    deleteMut.mutate(ids);
  });

  const commitRename = useEvent(async (id: number, name: string) => {
    setRenamingId(null);
    const current = entries.find((e) => e.id === id);
    if (current === undefined || current.name === name) return;
    try {
      // новое имя - на карточке сразу; перечитывание (порядок, дерево) догонит, папка на 60k - секунды
      patchCachedEntries(qc, [await updateEntry(id, { name })]);
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
    // занятые имена - всё содержимое текущего вида, но конфликт считается в пределах одной папки
    const changes = planSuffixRename(selectedEntries, entries);
    if (changes.length === 0) {
      const names = selectedEntries.map((en) => foldForSearch(en.name));
      const sameNames = new Set(names).size !== names.length;
      toast(
        sameNames
          ? 'Одинаковые имена — в разных папках, конфликтов нет' // поиск показал файлы из разных папок
          : 'Среди выделенных нет одинаковых имён',
        'info',
      );
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

  // новая таблица сразу открывается: создали - и можно писать
  const openNewTable = useEvent(async (id: number | null) => {
    refreshContent();
    if (id === null) {
      toast('Таблица создана', 'success');
      return;
    }
    try {
      setViewer({ kind: 'table', entry: await getEntry(id) });
    } catch {
      // не прочиталась - карточка уже в папке, откроется оттуда
    }
  });

  const lock = useEvent(async () => {
    // открытая таблица: сначала дописать правки - после блокировки писать будет некуда
    if (tableRef.current !== null && !(await tableRef.current.saveNow())) {
      toast('Таблица не сохранена — сейф не заблокирован. Закройте таблицу и повторите', 'error');
      return;
    }
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

  // «Места» на цифрах 1–9 и недавние папки назначения
  const placesApi = usePlaces();
  const { places } = placesApi;
  const foldersData = useQuery(foldersQuery).data;
  const pathById = useMemo(
    () => new Map(folderPaths(foldersData?.folders ?? []).map((p) => [p.id, p])),
    [foldersData],
  );
  const placeChips = useMemo<PlaceChip[]>(
    () =>
      places.flatMap((id, i) => {
        const p = id === null ? undefined : pathById.get(id);
        return p === undefined ? [] : [{ digit: i + 1, id: p.id, label: p.name, title: p.label }];
      }),
    [places, pathById],
  );
  const labelOf = (id: number | null) => (id === null ? 'Все объекты' : (pathById.get(id)?.label ?? 'папку'));

  const togglePlace = useEvent((id: number) => {
    const name = pathById.get(id)?.label ?? 'Папка';
    const was = placeDigit(places, id);
    if (!placesApi.togglePlace(id)) {
      toast('Все 9 мест заняты — сначала уберите одно (★ в окне перемещения или правый клик в дереве)', 'info');
      return;
    }
    if (was !== undefined) toast(`«${name}» убрана из «Мест»`, 'info');
    else toast(`«${name}» — место ${placeDigit(toggledPlaces(places, id), id) ?? ''}: цифра перемещает сюда`, 'success');
  });

  const movesUndone = useRef(new WeakSet<MoveUndo>()); // «Отменить» в тосте после Ctrl+Z - уже нечего
  const undoMove = useEvent(async (rec?: MoveUndo) => {
    const r = rec ?? lastMoved.current;
    if (r === null || movesUndone.current.has(r)) return;
    movesUndone.current.add(r);
    if (lastMoved.current === r) lastMoved.current = null;
    try {
      let n = 0;
      for (const [parent, ids] of r.groups) {
        const res = await moveEntries(ids, parent); // имя на старом месте заняли - сервер оставит оба
        n += res.moved + res.replaced;
      }
      toast(`Возвращено на место: ${plural(n, 'объект', 'объекта', 'объектов')}`, 'success');
    } catch (e) {
      movesUndone.current.delete(r);
      if (!isUnauthorized(e)) toast(errorMessage(e, 'Не удалось отменить перемещение'), 'error');
    }
    refreshContent();
  });

  // перемещение с тостом «… → «папка»» и «Отменить»; true - что-то переместилось
  const moveTo = useEvent(async (moving: Entry[], parentId: number | null, label?: string): Promise<boolean> => {
    const list = moving.filter((e) => e.parentId !== parentId);
    if (list.length === 0) return false;
    const groups = new Map<number | null, number[]>();
    for (const e of list) {
      const g = groups.get(e.parentId);
      if (g === undefined) groups.set(e.parentId, [e.id]);
      else g.push(e.id);
    }
    const rec: MoveUndo = { groups: [...groups] };
    const result = await moveEntriesTo(list, parentId, {
      label: label ?? labelOf(parentId),
      undo: () => void undoMove(rec),
    });
    if (result === null || result.moved + result.replaced === 0) return false;
    if (result.skipped === 0) {
      lastMoved.current = rec;
      lastAction.current = 'move';
      dropFromViewer(list.map((e) => e.id));
    }
    if (parentId !== null && (pathById.has(parentId) || label !== undefined)) placesApi.addRecent(parentId);
    return true;
  });

  // новая папка по пути от корня («Мемы/Коты») - и сразу туда
  const createAndMove = useEvent(async (moving: Entry[], path: string): Promise<boolean> => {
    let id: number | null | undefined;
    try {
      [id] = (await createFolders(null, [path])).ids;
    } catch (e) {
      if (!isUnauthorized(e)) toast(errorMessage(e, 'Не удалось создать папку'), 'error');
      return false;
    }
    if (id === null || id === undefined) return false;
    void qc.invalidateQueries({ queryKey: foldersQuery.queryKey });
    return moveTo(moving, id, path.split('/').join(' / '));
  });

  const openPalette = useEvent((list: Entry[], done?: (moved: boolean) => void) => {
    if (list.length === 0) {
      done?.(false);
      return;
    }
    setPalette({ entries: list, done });
  });

  const dnd = useEntryDnd({ entries, selected: selection.selected, onMove: (m, p) => void moveTo(m, p) });

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
      patchCachedEntries(qc, [await updateEntry(id, patch)]);
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
    const index = listing.data.entries.findIndex((e) => e.id === reveal);
    if (index >= 0) {
      selectOnly(reveal);
      setPropsOpen(true);
      galleryRef.current?.reveal(index);
    } else if (!listing.data.complete && !listing.isFetchNextPageError) return; // ждём следующую страницу
    setReveal(null);
  }, [reveal, showResults, listing.isPlaceholderData, listing.data, listing.isFetchNextPageError, selectOnly]);

  // теги/описание изменились - обновляем и снимки в открытом просмотрщике,
  // чтобы панель слева показывала свежие теги (сами карточки обновляет запрос)
  useEffect(() => {
    const byId = new Map(entries.map((e) => [e.id, e]));
    setViewer((v) => {
      if (v === null) return v;
      if (v.kind !== 'media') {
        const fresh = byId.get(v.entry.id);
        return fresh !== undefined && fresh !== v.entry ? { ...v, entry: fresh } : v;
      }
      const items = v.items.map((p) => byId.get(p.id) ?? p);
      if (items.every((p, i) => p === v.items[i])) return v;
      const current = v.items[v.index]?.id;
      const index = Math.max(0, items.findIndex((p) => p.id === current));
      return { ...v, items, index };
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
    setTrashOpen(false);
    setRenamingId(null);
  });

  // клик по тегу на экране «Теги», чипу карточки или панели свойств: фильтр по
  // нему на весь сейф; что выбрано - в строке фильтра над галереей
  const filterByTag = useEvent((tagId: number) => {
    setFilter((f) => ({ ...f, tags: [tagId], scope: 'vault' }));
    setSearchText('');
    setCommittedQuery('');
    setTagsOpen(false);
    setTrashOpen(false);
    setRenamingId(null);
  });

  // галочка в панели «Теги»: добавить тег в фильтр или убрать (можно несколько)
  const toggleFilterTag = useEvent((next: TagFilter) => {
    setFilter(next);
    setSearchText('');
    setCommittedQuery('');
    setTrashOpen(false);
    setRenamingId(null);
  });

  // папка в дереве при заданном фильтре - фильтр сужается до неё (корень - весь
  // сейф), теги остаются; без фильтра - обычный переход в папку
  const navigateTree = useEvent((id: number | null) => {
    if (!isFilterActive(filter)) {
      navigate(id);
      return;
    }
    setFolderId(id);
    setFilter((f) => ({ ...f, scope: id === null ? 'vault' : 'folder' }));
    setTagsOpen(false);
    setTrashOpen(false);
    setRenamingId(null);
    setReveal(null);
    clearSelection();
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
        openPalette([entry]);
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

  // ── Меню папки в дереве ───────────────────────────────────────────────────

  const onTreeContextMenu = useCallback((e: MouseEvent, id: number | null) => {
    e.preventDefault();
    setTreeMenu({ x: e.clientX, y: e.clientY, id });
  }, []);
  const placeOfTree = useCallback((id: number) => placeDigit(places, id), [places]);

  const runFolderAction = useEvent(async (action: FolderMenuAction, id: number | null) => {
    if (action === 'newFolder') {
      setNameRequest({ kind: 'create', parentId: id, parentLabel: labelOf(id) });
      return;
    }
    if (id === null) return;
    switch (action) {
      case 'open':
        navigateTree(id);
        return;
      case 'rename':
        setNameRequest({ kind: 'rename', id, name: pathById.get(id)?.name ?? '' });
        return;
      case 'place':
        togglePlace(id);
        return;
      case 'properties':
        void openSource(id); // в родителя, папка выделена, свойства открыты
        return;
      case 'delete':
        requestDelete([id]);
        return;
      case 'move':
      case 'download':
        break;
    }
    // дальше нужна сама запись папки
    try {
      const entry = await qc.fetchQuery({ ...entryQuery(id), staleTime: 0 });
      if (action === 'move') openPalette([entry]);
      else downloadEntry(entry);
    } catch (e) {
      if (!isUnauthorized(e)) toast(errorMessage(e, 'Не удалось открыть папку'), 'error');
    }
  });

  // ── Карточки ──────────────────────────────────────────────────────────────

  // модель B (Ф4): клик выделяет, двойной клик / Enter открывает, пробел - быстрый просмотр
  const onCardClick = useEvent((e: MouseEvent, entry: Entry) => {
    if (e.ctrlKey || e.metaKey) selection.toggle(entry.id);
    else if (e.shiftKey) selection.extendTo(entry.id);
    else selection.only(entry.id);
  });

  const onCardDoubleClick = useEvent((e: MouseEvent, entry: Entry) => {
    if (e.ctrlKey || e.metaKey || e.shiftKey || isInteractiveTarget(e.target)) return;
    openEntry(entry);
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
      onDoubleClick: onCardDoubleClick,
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
    [onCardClick, onCardDoubleClick, toggleSelect, onCardContextMenu, commitRename, dnd.card, links.addFromText, filterByTag, openCardTags],
  );

  // ── Клавиатура ────────────────────────────────────────────────────────────

  // Ctrl+Z - вернуть последнее удалённое; работает и из просмотрщика
  useWindowEvent('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
    if (e.key.toLowerCase() !== 'z' && e.code !== 'KeyZ') return;
    if (e.defaultPrevented || isTypingTarget(e.target) || confirm !== null || menu !== null || treeMenu !== null) return;
    if (tagsOpen || palette !== null || (anyModalOpen() && viewer?.kind !== 'media')) return; // в диалогах Ctrl+Z не наш
    // отменяется последнее из двух: перемещение или удаление
    if (lastMoved.current !== null && (lastAction.current === 'move' || lastTrashed.current === null)) {
      e.preventDefault();
      lastAction.current = null;
      void undoMove();
      return;
    }
    if (lastTrashed.current === null) return;
    e.preventDefault();
    undoDelete();
  });

  useWindowEvent('keydown', (e) => {
    if (e.defaultPrevented || isTypingTarget(e.target) || anyModalOpen() || menu !== null || tagsOpen) return;
    if (treeMenu !== null) return;
    if (trashOpen) return; // у корзины свои клавиши
    const { selected } = selection;
    const [first] = selected;
    const ctrl = e.ctrlKey || e.metaKey;

    if (e.key === 'Escape') {
      // сверху лежат панели: сначала закрываем их, потом снимаем выделение
      if (propsOpen) setPropsOpen(false);
      else if (selected.size > 0) selection.clear();
      else if (isSearch) setSearchText('');
      else if (isFilter) setFilter((f) => ({ ...f, tags: [] }));
    } else if (e.key === 'F2') {
      const target = selected.size === 1 && first !== undefined ? first : hoveredId.current;
      if (target !== null) {
        e.preventDefault();
        setRenamingId(target);
        galleryRef.current?.reveal(visibleIds.indexOf(target)); // выделенная могла быть прокручена далеко
      }
    } else if (e.key === 'Delete') {
      if (e.repeat) return; // зажатый Delete - одна пачка, не по карточке на повтор
      if (selected.size > 0) {
        e.preventDefault();
        requestDelete([...selected]);
      }
    } else if (e.key === 'Enter' && e.altKey) {
      // Alt+Enter: свойства выделенной (или той, над которой курсор) записи
      e.preventDefault();
      openProperties(selected.size === 0 ? hoveredId.current : null);
    } else if (e.key === 'Enter') {
      if (e.repeat || isInteractiveTarget(e.target) || selected.size !== 1) return;
      const entry = entries.find((en) => en.id === first);
      if (entry !== undefined) openEntry(entry);
    } else if (e.key === ' ' && !ctrl) {
      // пробел - быстрый просмотр выделенного фото, видео, аудио, текста или ролика (на фото пробел в просмотре закрывает)
      if (e.repeat || isInteractiveTarget(e.target) || selected.size !== 1) return;
      const entry = entries.find((en) => en.id === first);
      if (entry === undefined || !isViewable(entry)) return;
      e.preventDefault();
      viewMedia(entry);
    } else if (ctrl && (e.key.toLowerCase() === 'a' || e.code === 'KeyA')) {
      // e.code - физическая клавиша: Ctrl+A работает и на русской раскладке (e.key = «ф»)
      e.preventDefault();
      if (!complete) {
        // загружена только часть: «выделить всё» + Delete задели бы не всё, что в папке
        const n = (v: number) => v.toLocaleString('ru-RU');
        toast(`Ещё загружается: ${n(entries.length)} из ${n(total)} - выделить всё можно после загрузки`, 'info');
        return;
      }
      selection.selectAll();
    } else if (!ctrl && !e.altKey && !e.shiftKey && digitOfKey(e.code) !== undefined) {
      // 1–9: выделенное - в «Место» с этой цифрой
      const target = placeAt(places, digitOfKey(e.code) ?? 0);
      if (e.repeat || target === undefined || selectedEntries.length === 0) return;
      e.preventDefault();
      void moveTo(selectedEntries, target);
    } else if (!ctrl && !e.altKey && e.code === 'KeyM') {
      // M (на любой раскладке): «Переместить в…» для выделенного или того, что под курсором
      const hovered = entries.find((en) => en.id === hoveredId.current);
      const list = selectedEntries.length > 0 ? selectedEntries : hovered !== undefined ? [hovered] : [];
      if (e.repeat || list.length === 0) return;
      e.preventDefault();
      openPalette(list);
    } else if (!ctrl && isNavKey(e.key)) {
      e.preventDefault();
      const id = selection.move(e.key, galleryRef.current?.columns() ?? 1, e.shiftKey);
      if (id !== undefined) galleryRef.current?.reveal(visibleIds.indexOf(id));
    }
  });

  // ── Вставка из буфера (Ctrl+V): файлы/картинки и ссылки ──────────────────

  useWindowEvent('paste', (e) => {
    if (isTypingTarget(e.target) || anyModalOpen() || tagsOpen || trashOpen) return; // в полях вставка обычная
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
    if (trashOpen) return null; // в корзину ничего не бросают: папки назначения не видно
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

  // подсветка в дереве: открытая папка; при фильтре - только если он сужен до неё
  const treeCurrent = trashOpen || isSearch || (isFilter && filter.scope !== 'folder') ? undefined : folderId;

  // не догрузилась страница - загруженное остаётся на экране, причина в строке состояния
  const contentError = content.isFetchNextPageError ? null : (content.error ?? null);
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
          if (text !== '') {
            setTagsOpen(false);
            setTrashOpen(false);
          }
        }}
        onNavigate={navigate}
        onImportFiles={(files) => importFiles(files)}
        onWatchFolder={() => void watch.enable()}
        onAddLink={(url) => void links.addLinks([url], folderId)}
        onImportBookmarks={(file) => void links.importBookmarks(file, folderId)}
        onNewTable={() => setNewTable(true)}
        onLock={() => void lock()}
        safe={safe}
      />

      <DockedWorkspace
        panels={{
          folders: {
            title: 'Папки',
            children: (
              <div className="pb-2">
                <FolderTree
                  current={treeCurrent}
                  expandPath={expandPath}
                  onNavigate={navigateTree}
                  dnd={dnd.tree}
                  onContextMenu={onTreeContextMenu}
                  placeOf={placeOfTree}
                  menuFor={treeMenu === null ? undefined : treeMenu.id}
                />
                <div className="px-2 pt-1">
                  <button
                    type="button"
                    aria-current={trashOpen ? 'page' : undefined}
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm transition ${
                      trashOpen ? 'bg-accent/20 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'
                    }`}
                    onClick={() => {
                      setTrashOpen(true);
                      setTagsOpen(false);
                      setRenamingId(null);
                      clearSelection();
                    }}
                  >
                    <span aria-hidden="true">🗑</span>
                    <span className="flex-1">Корзина</span>
                    {trashCount > 0 && <span className="text-xs tabular-nums text-zinc-500">{trashCount}</span>}
                  </button>
                </div>
              </div>
            ),
          },
          tags: {
            title: 'Теги',
            label: 'Каталог тегов',
            badge: isFilter ? (
              <span
                className="rounded-full bg-accent px-1.5 text-[10px] font-medium normal-case leading-4 tracking-normal text-white"
                aria-label={`Выбрано тегов: ${filter.tags.length}`}
                title="Выбрано в фильтре"
              >
                {filter.tags.length}
              </span>
            ) : undefined,
            actions: <TagsPanelActions onManage={() => setTagsOpen(true)} />,
            children: <TagsPanelBody filter={filter} onToggleTag={toggleFilterTag} />,
          },
        }}
      >
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

        {trashOpen ? (
          <TrashView onChanged={() => (lastTrashed.current = null)} />
        ) : (
          <div className="flex min-w-0 flex-1 flex-col">
          {isFilter && <FilterBar filter={filter} folderId={folderId} onChange={changeFilter} />}
          <main
            ref={mainRef}
            // место под полосу прокрутки занято всегда: иначе её появление сужает
            // карточки, они становятся ниже, сетка - короче, полоса пропадает… (Gallery)
            className={`min-h-0 flex-1 overflow-y-auto p-4 pb-20 [scrollbar-gutter:stable] ${rubber.box !== null ? 'select-none' : ''}`}
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
                total={total}
                scrollRef={mainRef}
                handleRef={galleryRef}
                loading={loading}
                isSearch={showResults}
                selection={selection.selected}
                renamingId={renamingId}
                handlers={cardHandlers}
              />
            )}
          </main>
          </div>
        )}
      </DockedWorkspace>

      <StatusBar
        safe={safe}
        isSearch={showResults}
        found={total}
        loaded={complete ? undefined : entries.length}
        pageError={content.isFetchNextPageError}
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
          onMove={() => openPalette(selectedEntries)}
          onProperties={() => openProperties(null)}
          onDelete={() => requestDelete([...selection.selected])}
          onClear={clearSelection}
        />
      )}

      {importer.progress !== null && <ImportPanel progress={importer.progress} />}

      {treeMenu !== null && (
        <MenuPopup
          x={treeMenu.x}
          y={treeMenu.y}
          label={treeMenu.id === null ? 'Все объекты' : `Папка «${pathById.get(treeMenu.id)?.name ?? ''}»`}
          items={folderMenuItems({
            isRoot: treeMenu.id === null,
            placeDigit: treeMenu.id === null ? undefined : placeDigit(places, treeMenu.id),
            placesFull: isPlacesFull(places),
          })}
          onClose={() => setTreeMenu(null)}
          onPick={(action) => void runFolderAction(action, treeMenu.id)}
        />
      )}

      {menu !== null && (
        <ContextMenu
          state={menu}
          onClose={() => setMenu(null)}
          onAction={runMenuAction}
        />
      )}

      {viewer?.kind === 'media' && (
        <MediaViewer
          items={viewer.items}
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
          onDelete={(en) => requestDelete([en.id])}
          places={placeChips}
          onMoveTo={(en, parentId) => moveTo([en], parentId)}
          onMovePick={(en) => new Promise<boolean>((resolve) => openPalette([en], resolve))}
        />
      )}
      {viewer?.kind === 'link' && <LinkConfirm entry={viewer.entry} onClose={() => setViewer(null)} />}
      {viewer?.kind === 'table' && (
        <TableView
          key={viewer.entry.id}
          entry={viewer.entry}
          handleRef={tableRef}
          onClose={() => setViewer(null)}
          onSaved={(fresh) => patchCachedEntries(qc, [fresh])}
        />
      )}
      {newTable && (
        <NewTableDialog
          parentId={folderId}
          onClose={() => setNewTable(false)}
          onCreated={(id) => void openNewTable(id)}
        />
      )}

      {confirm !== null && <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />}

      {palette !== null && (
        <MovePalette
          entries={palette.entries}
          places={places}
          recent={placesApi.recent}
          onTogglePlace={togglePlace}
          onMove={(parentId) => {
            setPalette(null);
            void moveTo(palette.entries, parentId).then((ok) => palette.done?.(ok));
          }}
          onCreate={(path) => {
            setPalette(null);
            void createAndMove(palette.entries, path).then((ok) => palette.done?.(ok));
          }}
          onClose={() => {
            setPalette(null);
            palette.done?.(false);
          }}
        />
      )}

      {nameRequest?.kind === 'create' && (
        <NameDialog
          title={nameRequest.parentId === null ? 'Новая папка' : `Новая папка в «${nameRequest.parentLabel}»`}
          submitLabel="Создать"
          onSubmit={async (name) => {
            await createFolders(nameRequest.parentId, [name]);
            refreshContent();
            toast(`Папка «${name}» создана`, 'success');
          }}
          onClose={() => setNameRequest(null)}
        />
      )}
      {nameRequest?.kind === 'rename' && (
        <NameDialog
          title="Переименовать папку"
          initial={nameRequest.name}
          submitLabel="Переименовать"
          onSubmit={async (name) => {
            patchCachedEntries(qc, [await updateEntry(nameRequest.id, { name })]);
            refreshContent();
          }}
          onClose={() => setNameRequest(null)}
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
