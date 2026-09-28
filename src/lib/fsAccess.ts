// File System Access API (Chromium): выбор наблюдаемой папки и чтение файлов.
// В Firefox/Safari showDirectoryPicker отсутствует — пункт меню скрывается.

import type { WatchFile } from './watch';

export interface WatchDirHandle {
  kind: 'directory';
  name: string;
  values(): AsyncIterableIterator<DirEntryLike>;
  queryPermission?(desc: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission?(desc: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
}

interface DirEntryLike {
  kind: string;
  name: string;
  getFile(): Promise<File>;
}

export interface WatchEntry {
  wf: WatchFile;
  getFile: () => Promise<File>;
}

declare global {
  interface Window {
    showDirectoryPicker?: (options?: {
      id?: string;
      mode?: 'read' | 'readwrite';
    }) => Promise<FileSystemDirectoryHandle>;
  }
}

export function supportsWatch(): boolean {
  return typeof window.showDirectoryPicker === 'function';
}

/** null = пользователь отменил выбор или API нет. Вызывать из клика. */
export async function pickWatchDirectory(): Promise<WatchDirHandle | null> {
  try {
    const handle = await window.showDirectoryPicker?.({ id: 'safebox-watch', mode: 'read' });
    return (handle as unknown as WatchDirHandle) ?? null;
  } catch {
    return null; // отмена диалога
  }
}

/** Файлы верхнего уровня папки (подпапки не трогаем). */
export async function listWatchEntries(dir: WatchDirHandle): Promise<WatchEntry[]> {
  const out: WatchEntry[] = [];
  for await (const entry of dir.values()) {
    if (entry.kind !== 'file') continue;
    try {
      const file = await entry.getFile();
      out.push({
        wf: { name: file.name, size: file.size, mtime: file.lastModified },
        getFile: () => entry.getFile(),
      });
    } catch {
      // файл успели удалить — пропускаем
    }
  }
  return out;
}

export async function permissionOf(dir: WatchDirHandle): Promise<PermissionState> {
  try {
    return (await dir.queryPermission?.({ mode: 'read' })) ?? 'granted';
  } catch {
    return 'denied';
  }
}

/** Требует жеста пользователя (клик по чипу «возобновить»). */
export async function requestReadPermission(dir: WatchDirHandle): Promise<PermissionState> {
  try {
    return (await dir.requestPermission?.({ mode: 'read' })) ?? 'granted';
  } catch {
    return 'denied';
  }
}
