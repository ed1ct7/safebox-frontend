import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent, MouseEvent } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { deleteEntries, downloadUrlOf, importEntries, lockSafe, renameEntry } from '../api/endpoints';
import type { PendingFile } from '../api/endpoints';
import { ApiRequestError, errorMessage, isUnauthorized } from '../api/client';
import { invalidateContent, listingQuery, searchQuery, statusQuery } from '../api/queries';
import type { Entry } from '../api/types';
import { isInteractiveTarget, isTypingTarget, triggerDownload, triggerDownloads } from '../lib/dom';
import { filesFromDataTransfer, pastedFile } from '../lib/dnd';
import { plural } from '../lib/format';
import {
  displayName,
  isDuplicateLink,
  isHttpUrl,
  linkNameFromUrl,
  makeUrlShortcut,
  uniqueLinkFileName,
} from '../lib/link';
import { isNavKey } from '../lib/selection';
import { folderAfterDelete } from '../lib/tree';
import { useEvent, useWindowEvent } from '../hooks/useEvent';
import { useHeartbeat } from '../hooks/useHeartbeat';
import { useImporter } from '../hooks/useImporter';
import { useSelection } from '../hooks/useSelection';
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
import { SelectionBar } from './SelectionBar';
import { StatusBar } from './StatusBar';
import { TopBar } from './TopBar';
import { useToast } from './Toasts';
import { VideoModal } from './VideoModal';

const SEARCH_DEBOUNCE_MS = 240; // UF-8

type Viewer =
  | { kind: 'photos'; photos: Entry[]; index: number }
  | { kind: 'video'; entry: Entry }
  | { kind: 'link'; entry: Entry };

/** Главное окно: дерево слева, крошки и поиск сверху, сетка карточек в центре. */
export function MainShell({ onLocked }: { onLocked: () => void }) {
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

  // ── Данные ────────────────────────────────────────────────────────────────

  const status = useQuery(statusQuery);
  const safe = status.data?.safe;

  useEffect(() => {
    // токен умер (блокировка в другой вкладке и т.п.) — на экран входа
    if (status.data !== undefined && !status.data.authorized) onLocked();
  }, [status.data, onLocked]);

  const listing = useQuery({
    ...listingQuery(folderId),
    enabled: !isSearch,
    placeholderData: keepPreviousData,
  });
  const search = useQuery({
    ...searchQuery(committedQuery),
    enabled: isSearch,
    placeholderData: keepPreviousData,
  });

  // крошки открытой папки (для «удалили открытую папку — на родителя»)
  const folderPath = listing.isPlaceholderData ? undefined : listing.data?.path;

  const items = useMemo<DisplayItem[]>(() => {
    if (!isSearch) return (listing.data?.entries ?? []).map((entry) => ({ entry }));
    return (search.data?.results ?? []).map((h) => ({
      entry: h.entry,
      caption: h.path.length > 0 ? h.path.map((p) => p.name).join(' / ') : 'Все объекты',
    }));
  }, [isSearch, listing.data, search.data]);

  const entries = useMemo(() => items.map((d) => d.entry), [items]);
  const visibleIds = useMemo(() => entries.map((e) => e.id), [entries]);
  const selection = useSelection(visibleIds);
  const { clear: clearSelection, toggle: toggleSelect } = selection; // стабильные

  const refreshContent = useCallback(() => invalidateContent(qc), [qc]);

  // ── Состояние окна ────────────────────────────────────────────────────────

  const [renamingId, setRenamingId] = useState<number | null>(null);
  const hoveredId = useRef<number | null>(null); // только для F2 — без перерисовок
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  const navigate = useCallback(
    (id: number | null) => {
      setFolderId(id);
      setSearchText('');
      setCommittedQuery('');
      setRenamingId(null);
      clearSelection();
    },
    [clearSelection],
  );

  // открытую папку удалили в другой вкладке/через поиск — в корень
  useEffect(() => {
    const e = listing.error;
    if (folderId !== null && e instanceof ApiRequestError && (e.status === 404 || e.status === 422)) {
      toast('Папка больше не существует', 'info');
      navigate(null);
    }
  }, [listing.error, folderId, navigate, toast]);

  // ── Импорт ────────────────────────────────────────────────────────────────

  const importer = useImporter({ onBatchDone: refreshContent, onActivity: markActivity });
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

  const addLink = useEvent(async (url: string) => {
    const target = folderId;
    try {
      const existing = (await qc.fetchQuery(listingQuery(target))).entries;
      if (isDuplicateLink(existing, url)) {
        toast('Эта ссылка уже есть в папке', 'info');
        return;
      }
      const fileName = uniqueLinkFileName(existing, linkNameFromUrl(url));
      // ссылки попадают в сейф контрактом: импорт ярлыка .url
      const r = await importEntries(target, [makeUrlShortcut(url, fileName)]);
      if (r.imported > 0) toast(`Ссылка добавлена: ${fileName.replace(/\.url$/i, '')}`, 'success');
      else toast(r.failures[0]?.message ?? 'Ссылка не добавлена', 'error');
      refreshContent();
    } catch (e) {
      if (!isUnauthorized(e)) toast(errorMessage(e, 'Не удалось добавить ссылку'), 'error');
    }
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
        if (isSearch) setFolderId(back);
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
    const hasFolder = doomed.some((e) => e.kind === 'folder');
    setConfirm({
      title:
        doomed.length === 1 && single !== undefined
          ? `Удалить «${displayName(single)}»?`
          : `Удалить ${plural(ids.length, 'объект', 'объекта', 'объектов')}?`,
      message: hasFolder
        ? 'Папки удаляются вместе со всем содержимым.\nВосстановить удалённое нельзя.'
        : 'Восстановить удалённое нельзя.',
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
      await renameEntry(id, name);
      refreshContent();
    } catch (e) {
      if (!isUnauthorized(e)) toast(errorMessage(e, 'Не удалось переименовать'), 'error');
    }
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
    }),
    [onCardClick, toggleSelect, onCardContextMenu, commitRename],
  );

  // ── Клавиатура ────────────────────────────────────────────────────────────

  useWindowEvent('keydown', (e) => {
    if (e.defaultPrevented || isTypingTarget(e.target) || anyModalOpen() || menu !== null) return;
    const { selected } = selection;
    const [first] = selected;
    const ctrl = e.ctrlKey || e.metaKey;

    if (e.key === 'Escape') {
      if (selected.size > 0) selection.clear();
      else if (isSearch) setSearchText('');
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
    } else if (e.key === 'Enter') {
      if (isInteractiveTarget(e.target) || selected.size !== 1) return;
      const entry = entries.find((en) => en.id === first);
      if (entry !== undefined) openEntry(entry);
    } else if (ctrl && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      selection.selectAll();
    } else if (!ctrl && isNavKey(e.key)) {
      e.preventDefault();
      selection.move(e.key);
    }
  });

  // ── Вставка из буфера (Ctrl+V): файлы/картинки и ссылки ──────────────────

  useWindowEvent('paste', (e) => {
    if (isTypingTarget(e.target) || anyModalOpen()) return; // в полях вставка обычная
    const cd = e.clipboardData;
    if (cd === null) return;
    if (cd.files.length > 0) {
      e.preventDefault();
      // скопированная в браузере картинка или файл из проводника
      importFiles(Array.from(cd.files).map(pastedFile));
      return;
    }
    const text = cd.getData('text').trim();
    if (isHttpUrl(text)) {
      e.preventDefault();
      void addLink(text);
    }
  });

  // ── Drag&drop ─────────────────────────────────────────────────────────────

  const hasFiles = (e: DragEvent) => e.dataTransfer.types.includes('Files');
  const dropHandlers = {
    onDragEnter: (e: DragEvent) => {
      if (!hasFiles(e)) return;
      dragDepth.current += 1;
      setDragging(true);
    },
    onDragOver: (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    },
    onDragLeave: (e: DragEvent) => {
      if (!hasFiles(e)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      void filesFromDataTransfer(e.dataTransfer).then((files) => importFiles(files));
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

  const contentError = (isSearch ? search.error : listing.error) ?? null;
  const loading = isSearch ? search.isPending : listing.isPending;

  return (
    <div className="flex h-screen flex-col" {...dropHandlers}>
      <TopBar
        path={isSearch ? null : (listing.data?.path ?? [])}
        searchQuery={committedQuery}
        searchText={searchText}
        onSearchText={setSearchText}
        onNavigate={navigate}
        onImportFiles={(files) => importFiles(files)}
        onWatchFolder={() => void watch.enable()}
        onAddLink={(url) => void addLink(url)}
        onLock={() => void lock()}
        safe={safe}
      />

      <div className="flex min-h-0 flex-1">
        <aside className="w-60 shrink-0 overflow-y-auto border-r border-zinc-800 py-3">
          <p className="px-4 pb-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-600">
            Папки
          </p>
          <FolderTree current={isSearch ? undefined : folderId} onNavigate={navigate} />
        </aside>

        <main
          className="flex-1 overflow-y-auto p-4 pb-20"
          onClick={(e) => {
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
              isSearch={isSearch}
              selection={selection.selected}
              renamingId={renamingId}
              handlers={cardHandlers}
            />
          )}
        </main>
      </div>

      <StatusBar
        safe={safe}
        isSearch={isSearch}
        found={entries.length}
        watch={{ status: watch.status, folderName: watch.folderName }}
        onWatchResume={() => void watch.resume()}
        onWatchDisable={() => void watch.disable()}
      />

      {selection.selected.size > 0 && (
        <SelectionBar
          count={selection.selected.size}
          canDownload={selectionUrls.length > 0}
          onDownload={() => triggerDownloads(selectionUrls)}
          onRename={() => {
            const [id] = selection.selected;
            if (id !== undefined) setRenamingId(id);
          }}
          onDelete={() => requestDelete([...selection.selected])}
          onClear={clearSelection}
        />
      )}

      {importer.progress !== null && <ImportPanel progress={importer.progress} />}

      {menu !== null && (
        <ContextMenu
          state={menu}
          onClose={() => setMenu(null)}
          onOpen={openEntry}
          onDownload={downloadEntry}
          onRename={(entry) => setRenamingId(entry.id)}
          onDelete={(entry) => requestDelete([entry.id])}
        />
      )}

      {viewer?.kind === 'photos' && (
        <Lightbox
          photos={viewer.photos}
          index={viewer.index}
          onIndex={(index) => setViewer({ ...viewer, index })}
          onClose={() => setViewer(null)}
          onActivity={markActivity}
        />
      )}
      {viewer?.kind === 'video' && (
        <VideoModal entry={viewer.entry} onClose={() => setViewer(null)} onActivity={markActivity} />
      )}
      {viewer?.kind === 'link' && <LinkConfirm entry={viewer.entry} onClose={() => setViewer(null)} />}

      {confirm !== null && <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />}

      {idleWarningSec !== null && <IdleWarning seconds={idleWarningSec} onStay={stay} />}

      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-[60] m-3 flex items-center justify-center rounded-2xl border-2 border-dashed border-accent bg-accent/10 backdrop-blur-[2px]">
          <p className="rounded-lg bg-zinc-900/90 px-6 py-3 text-sm text-zinc-100 shadow-xl">
            Отпустите — файлы и папки импортируются в сейф
          </p>
        </div>
      )}
    </div>
  );
}
