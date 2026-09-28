import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MouseEvent } from 'react';
import {
  deleteEntries,
  deleteEntry,
  getSafeStatus,
  importEntries,
  listEntries,
  lockSafe,
  mediaUrl,
  renameEntry,
  searchEntries,
} from '../api/endpoints';
import type { PendingFile } from '../api/endpoints';
import type { Entry, PathItem } from '../api/types';
import { isTypingTarget, triggerDownload } from '../lib/dom';
import { filesFromDataTransfer, pastedFile } from '../lib/dnd';
import { existingEntries, filterDuplicates, isDuplicateLink } from '../lib/duplicates';
import { isHttpUrl, linkNameFromUrl, makeUrlShortcut } from '../lib/link';
import { plural } from '../lib/format';
import { markActivity, useHeartbeat } from '../hooks/useHeartbeat';
import { useWatchFolder } from '../hooks/useWatchFolder';
import { TopBar } from './TopBar';
import { FolderTree } from './FolderTree';
import { Gallery } from './Gallery';
import type { DisplayItem } from './Gallery';
import { SelectionBar } from './SelectionBar';
import { ContextMenu } from './ContextMenu';
import type { ContextMenuState } from './ContextMenu';
import { Lightbox } from './Lightbox';
import { VideoModal } from './VideoModal';
import { LinkConfirm } from './LinkConfirm';
import { IdleWarning } from './IdleWarning';
import { ImportPanel } from './ImportPanel';
import { StatusBar } from './StatusBar';
import { useToast } from './Toasts';

type View = { type: 'folder'; id: number | null } | { type: 'search'; q: string };

type Viewer =
  | { kind: 'photos'; photos: Entry[]; index: number }
  | { kind: 'video'; entry: Entry }
  | { kind: 'link'; entry: Entry };

interface ImportState {
  loaded: number;
  total: number;
  count: number;
}

export function MainShell({ onLocked }: { onLocked: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { activityRef, idleRemainingSec, refresh } = useHeartbeat();

  const [view, setView] = useState<View>({ type: 'folder', id: null });
  const lastFolderRef = useRef<number | null>(null);
  const [searchText, setSearchText] = useState('');
  const [selection, setSelection] = useState<Set<number>>(new Set());
  const [anchorId, setAnchorId] = useState<number | null>(null);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [importState, setImportState] = useState<ImportState | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  // ── Данные ────────────────────────────────────────────────────────────────

  const statusQuery = useQuery({ queryKey: ['status'], queryFn: getSafeStatus });
  const safe = statusQuery.data?.safe;

  useEffect(() => {
    // токен умер (блокировка в другой вкладке и т.п.) — на экран входа
    if (statusQuery.data !== undefined && !statusQuery.data.authorized) onLocked();
  }, [statusQuery.data, onLocked]);

  const activeFolderId = view.type === 'folder' ? view.id : lastFolderRef.current;
  const listingQuery = useQuery({
    queryKey: ['listing', activeFolderId],
    queryFn: () => listEntries(activeFolderId),
    enabled: view.type === 'folder',
    placeholderData: keepPreviousData,
  });
  const searchQuery = useQuery({
    queryKey: ['search', view.type === 'search' ? view.q : ''],
    queryFn: () => searchEntries(view.type === 'search' ? view.q : ''),
    enabled: view.type === 'search',
    placeholderData: keepPreviousData,
  });

  const displayItems = useMemo<DisplayItem[]>(() => {
    if (view.type === 'folder') {
      return (listingQuery.data?.entries ?? []).map((entry) => ({ entry }));
    }
    return (searchQuery.data?.results ?? []).map((h) => ({
      entry: h.entry,
      caption: h.path.length > 0 ? h.path.map((p) => p.name).join(' / ') : undefined,
    }));
  }, [view.type, listingQuery.data, searchQuery.data]);

  const entries = useMemo(() => displayItems.map((d) => d.entry), [displayItems]);

  const invalidateContent = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['listing'] });
    void qc.invalidateQueries({ queryKey: ['folders'] });
    void qc.invalidateQueries({ queryKey: ['status'] });
    void qc.invalidateQueries({ queryKey: ['search'] });
  }, [qc]);

  // ── Навигация и выделение ────────────────────────────────────────────────

  const clearSelection = useCallback(() => {
    setSelection(new Set());
    setAnchorId(null);
  }, []);

  const navigate = useCallback(
    (id: number | null) => {
      markActivity(activityRef);
      lastFolderRef.current = id;
      setSearchText('');
      setView({ type: 'folder', id });
      clearSelection();
    },
    [activityRef, clearSelection],
  );

  // дебаунс поиска ~240 мс (UF-8); пустой запрос возвращает в папку
  useEffect(() => {
    const q = searchText.trim();
    if (q === '') {
      setView({ type: 'folder', id: lastFolderRef.current });
      return;
    }
    const t = setTimeout(() => setView({ type: 'search', q }), 240);
    return () => clearTimeout(t);
  }, [searchText]);

  const toggleSelect = useCallback((id: number) => {
    setSelection((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setAnchorId(id);
  }, []);

  const rangeSelect = useCallback(
    (id: number) => {
      const ids = entries.map((e) => e.id);
      const a = ids.indexOf(anchorId ?? id);
      const b = ids.indexOf(id);
      if (a === -1 || b === -1) {
        setSelection(new Set([id]));
      } else {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        setSelection(new Set(ids.slice(lo, hi + 1)));
      }
      setAnchorId(id);
    },
    [entries, anchorId],
  );

  // ── Действия ──────────────────────────────────────────────────────────────

  const openEntry = useCallback(
    (entry: Entry) => {
      markActivity(activityRef);
      switch (entry.kind) {
        case 'folder':
          navigate(entry.id);
          break;
        case 'photo': {
          const photos = entries.filter((e) => e.kind === 'photo');
          const index = photos.findIndex((e) => e.id === entry.id);
          setViewer({ kind: 'photos', photos, index: Math.max(0, index) });
          break;
        }
        case 'video':
          setViewer({ kind: 'video', entry });
          break;
        case 'link':
          setViewer({ kind: 'link', entry });
          break;
        default:
          triggerDownload(mediaUrl(entry.id, 'download'));
      }
    },
    [activityRef, entries, navigate],
  );

  const downloadEntry = useCallback((entry: Entry) => {
    if (entry.kind === 'link') return;
    triggerDownload(mediaUrl(entry.id, entry.kind === 'folder' ? 'zip' : 'download'));
  }, []);

  const downloadSelection = useCallback(() => {
    for (const e of entries) {
      if (selection.has(e.id) && e.kind !== 'link') downloadEntry(e);
    }
  }, [entries, selection, downloadEntry]);

  const deleteMut = useMutation({
    mutationFn: async (ids: number[]) => {
      if (ids.length === 1) {
        const [id] = ids;
        if (id === undefined) throw new Error('Нечего удалять');
        return deleteEntry(id);
      }
      return deleteEntries(ids);
    },
    onSuccess: invalidateContent,
    onError: (e: Error) => toast(e.message, 'error'),
  });

  const confirmDelete = useCallback(
    (ids: number[]) => {
      if (ids.length === 0) return;
      markActivity(activityRef);
      const hasFolder = entries.some((e) => ids.includes(e.id) && e.kind === 'folder');
      const msg =
        `Удалить ${plural(ids.length, 'объект', 'объекта', 'объектов')}?` +
        (hasFolder ? '\nПапки удаляются вместе со всем содержимым.' : '');
      if (!window.confirm(msg)) return;
      const currentId = view.type === 'folder' ? view.id : null;
      const removingCurrent = currentId !== null && ids.includes(currentId);
      const parentId = listingQuery.data?.folder?.parentId ?? null;
      deleteMut.mutate(ids, {
        onSuccess: (r) => {
          toast(`Удалено: ${r.removed}`, 'success');
          clearSelection();
          // открытая папка удалена — возвращаемся на родителя (UF-10)
          if (removingCurrent) navigate(parentId);
        },
      });
    },
    [activityRef, entries, view, listingQuery.data, deleteMut, toast, clearSelection, navigate],
  );

  const commitRename = useCallback(
    async (id: number, name: string) => {
      setRenamingId(null);
      markActivity(activityRef);
      const current = entries.find((e) => e.id === id);
      if (current === undefined || current.name === name) return;
      try {
        await renameEntry(id, name);
        invalidateContent();
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Ошибка переименования', 'error');
      }
    },
    [activityRef, entries, invalidateContent, toast],
  );

  const addLink = useCallback(
    async (url: string) => {
      markActivity(activityRef);
      const name = linkNameFromUrl(url);
      const existing = await existingEntries(qc, lastFolderRef.current);
      if (isDuplicateLink(existing, url)) {
        toast(`Ссылка уже есть: ${linkNameFromUrl(url)}`, 'info');
        return;
      }
      try {
        // ссылки попадают в сейф контрактом: импорт ярлыка .url (docs/api.md §7)
        const r = await importEntries(lastFolderRef.current, [makeUrlShortcut(url)]);
        if (r.imported > 0) toast(`Ссылка добавлена: ${name}`, 'success');
        else toast(r.failures[0]?.message ?? 'Ссылка не добавлена', 'error');
        invalidateContent();
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Ошибка добавления ссылки', 'error');
      }
    },
    [activityRef, qc, invalidateContent, toast],
  );

  const runImport = useCallback(
    async (files: PendingFile[], source?: string) => {
      if (files.length === 0) return;
      markActivity(activityRef);
      // дубликаты (то же имя + размер в целевой папке) не доходят до сервера
      const folderId = lastFolderRef.current;
      const existing = await existingEntries(qc, folderId);
      const { files: unique, skipped } = filterDuplicates(files, existing);
      const from = source === undefined ? '' : ` из «${source}»`;
      if (unique.length === 0) {
        toast(`Уже в сейфе${from}: ${plural(skipped, 'дубликат', 'дубликата', 'дубликатов')}`, 'info');
        return;
      }
      setImportState({ loaded: 0, total: 0, count: unique.length });
      try {
        const r = await importEntries(folderId, unique, (loaded, total) => {
          setImportState({ loaded, total, count: unique.length });
          activityRef.current = true; // долгое действие = присутствие
        });
        const parts = [`Импортировано${from}: ${r.imported}`];
        if (r.failed > 0) parts.push(`ошибок: ${r.failed}`);
        if (skipped > 0) parts.push(`дубликатов пропущено: ${skipped}`);
        toast(parts.join(', '), r.failed > 0 ? 'error' : 'success');
        invalidateContent();
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Ошибка импорта', 'error');
      } finally {
        setImportState(null);
      }
    },
    [activityRef, qc, invalidateContent, toast],
  );

  // наблюдение за папкой загрузок: новые файлы — тем же путём, что и ручной импорт
  const watch = useWatchFolder((entries, folderName) => {
    markActivity(activityRef);
    void (async () => {
      try {
        const files = await Promise.all(entries.map((e) => e.getFile()));
        await runImport(files, folderName === '' ? undefined : folderName);
      } catch {
        // файл исчез между опросом и чтением
      }
    })();
  });

  const lock = useCallback(async () => {
    try {
      await lockSafe();
    } catch {
      // даже при ошибке считаем сессию завершенной — экран входа покажет статус
    }
    onLocked();
  }, [onLocked]);

  // ── События карточек ──────────────────────────────────────────────────────

  const onCardClick = useCallback(
    (e: MouseEvent, entry: Entry) => {
      markActivity(activityRef);
      if (e.ctrlKey || e.metaKey) toggleSelect(entry.id);
      else if (e.shiftKey) rangeSelect(entry.id);
      else openEntry(entry);
    },
    [activityRef, toggleSelect, rangeSelect, openEntry],
  );

  const onContextMenu = useCallback(
    (e: MouseEvent, entry: Entry) => {
      e.preventDefault();
      markActivity(activityRef);
      if (!selection.has(entry.id)) setSelection(new Set([entry.id]));
      setAnchorId(entry.id);
      setMenu({ x: e.clientX, y: e.clientY, entry });
    },
    [activityRef, selection],
  );

  // ── Клавиатура ────────────────────────────────────────────────────────────

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;

      if (e.key === 'Escape') {
        if (viewer !== null) setViewer(null);
        else if (renamingId !== null) setRenamingId(null);
        else if (menu !== null) setMenu(null);
        else if (selection.size > 0) clearSelection();
        else if (view.type === 'search') setSearchText('');
        return;
      }

      if (viewer !== null) return; // ←/→ внутри лайтбокса обрабатывает он сам

      if (e.key === 'F2') {
        const target = selection.size === 1 ? ([...selection][0] ?? null) : hoveredId;
        if (target !== null) {
          e.preventDefault();
          setRenamingId(target);
        }
      } else if (e.key === 'Delete') {
        if (selection.size > 0) {
          e.preventDefault();
          confirmDelete([...selection]);
        }
      } else if (e.key === 'Enter' && e.target === document.body) {
        if (selection.size === 1) {
          const id = [...selection][0];
          const entry = id === undefined ? undefined : entries.find((en) => en.id === id);
          if (entry !== undefined) openEntry(entry);
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setSelection(new Set(entries.map((en) => en.id)));
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') {
        const ids = entries.map((en) => en.id);
        if (ids.length === 0) return;
        e.preventDefault();
        let idx: number;
        const only = [...selection][0];
        if (selection.size !== 1 || only === undefined) {
          idx = e.key === 'ArrowRight' || e.key === 'Home' ? 0 : ids.length - 1;
        } else {
          const cur = ids.indexOf(only);
          if (e.key === 'Home') idx = 0;
          else if (e.key === 'End') idx = ids.length - 1;
          else if (e.key === 'ArrowRight') idx = Math.min(cur + 1, ids.length - 1);
          else idx = Math.max(cur - 1, 0);
        }
        const target = ids[idx];
        if (target !== undefined) {
          setSelection(new Set([target]));
          setAnchorId(target);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    viewer,
    renamingId,
    menu,
    selection,
    view.type,
    hoveredId,
    entries,
    clearSelection,
    confirmDelete,
    openEntry,
  ]);

  // ── Вставка из буфера (Ctrl+V): файлы/картинки и ссылки ──────────────────

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (isTypingTarget(e.target)) return; // в полях вставка работает как обычно
      const cd = e.clipboardData;
      if (cd !== null && cd.files.length > 0) {
        // скопированная в браузере картинка или файл из проводника
        void runImport(Array.from(cd.files).map(pastedFile));
        return;
      }
      const text = cd?.getData('text') ?? '';
      if (isHttpUrl(text)) void addLink(text);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [addLink, runImport]);

  // ── Экраны ────────────────────────────────────────────────────────────────

  if (statusQuery.isPending) {
    return (
      <div className="flex h-screen items-center justify-center">
        <span className="h-10 w-10 animate-spin rounded-full border-2 border-zinc-700 border-t-accent" />
      </div>
    );
  }

  if (statusQuery.isError) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 text-center">
        <p className="text-sm text-zinc-300">Нет соединения с сервером (порт 8900).</p>
        <div className="flex gap-2">
          <button
            className="rounded-lg bg-accent px-4 py-1.5 text-sm text-white hover:bg-accent-hover"
            onClick={() => void statusQuery.refetch()}
          >
            Повторить
          </button>
          <button
            className="rounded-lg border border-zinc-700 px-4 py-1.5 text-sm text-zinc-300 hover:border-zinc-500"
            onClick={onLocked}
          >
            К экрану входа
          </button>
        </div>
      </div>
    );
  }

  const crumbs: PathItem[] | null =
    view.type === 'search' ? null : (listingQuery.data?.path ?? []);
  const galleryLoading =
    view.type === 'folder' ? listingQuery.isPending : searchQuery.isPending;
  const contentError =
    (view.type === 'folder' ? listingQuery.error : searchQuery.error) ?? null;

  return (
    <div
      className="flex h-screen flex-col"
      onDragEnter={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          dragDepth.current += 1;
          setDragging(true);
        }
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault();
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        void filesFromDataTransfer(e.dataTransfer).then(runImport);
      }}
    >
      <TopBar
        path={crumbs}
        searchQuery={view.type === 'search' ? view.q : ''}
        searchText={searchText}
        onSearchText={setSearchText}
        onClearSearch={() => setSearchText('')}
        onNavigate={navigate}
        onImportFiles={(files) => void runImport(files)}
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
          <FolderTree
            current={view.type === 'folder' ? view.id : null}
            onNavigate={navigate}
          />
        </aside>

        <main
          className="flex-1 overflow-y-auto p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) clearSelection();
          }}
        >
          {contentError !== null ? (
            <div className="flex h-64 flex-col items-center justify-center gap-3">
              <p className="text-sm text-zinc-300">{contentError.message}</p>
              <button
                className="rounded-lg bg-accent px-4 py-1.5 text-sm text-white hover:bg-accent-hover"
                onClick={() => navigate(null)}
              >
                К корню
              </button>
            </div>
          ) : (
            <Gallery
              items={displayItems}
              loading={galleryLoading}
              isSearch={view.type === 'search'}
              selection={selection}
              renamingId={renamingId}
              onCardClick={onCardClick}
              onToggleSelect={toggleSelect}
              onContextMenu={onContextMenu}
              onRenameStart={setRenamingId}
              onRenameCommit={(id, name) => void commitRename(id, name)}
              onRenameCancel={() => setRenamingId(null)}
              onHover={setHoveredId}
            />
          )}
        </main>
      </div>

      <StatusBar
        safe={safe}
        isSearch={view.type === 'search'}
        found={entries.length}
        watch={{ status: watch.status, folderName: watch.folderName }}
        onWatchResume={() => void watch.resume()}
        onWatchDisable={() => void watch.disable()}
      />

      {selection.size > 0 && (
        <SelectionBar
          count={selection.size}
          onDownload={downloadSelection}
          onRename={() => {
            const id = [...selection][0];
            if (id !== undefined) setRenamingId(id);
          }}
          onDelete={() => confirmDelete([...selection])}
          onClear={clearSelection}
        />
      )}

      {importState !== null && (
        <ImportPanel loaded={importState.loaded} total={importState.total} count={importState.count} />
      )}

      {menu !== null && (
        <ContextMenu
          state={menu}
          onClose={() => setMenu(null)}
          onOpen={openEntry}
          onDownload={downloadEntry}
          onRename={(entry) => setRenamingId(entry.id)}
          onDelete={(entry) => confirmDelete([entry.id])}
        />
      )}

      {viewer?.kind === 'photos' && (
        <Lightbox
          photos={viewer.photos}
          index={viewer.index}
          onIndex={(i) =>
            setViewer((v) => (v !== null && v.kind === 'photos' ? { ...v, index: i } : v))
          }
          onClose={() => setViewer(null)}
          onActivity={() => markActivity(activityRef)}
        />
      )}

      {viewer?.kind === 'video' && (
        <VideoModal
          entry={viewer.entry}
          onClose={() => setViewer(null)}
          onActivity={() => markActivity(activityRef)}
        />
      )}

      {viewer?.kind === 'link' && (
        <LinkConfirm entry={viewer.entry} onClose={() => setViewer(null)} />
      )}

      {idleRemainingSec !== null && idleRemainingSec > 0 && idleRemainingSec <= 60 && (
        <IdleWarning seconds={idleRemainingSec} onStay={refresh} />
      )}

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
