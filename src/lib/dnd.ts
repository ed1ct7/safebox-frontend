import type { PendingFile } from '../api/endpoints';

/**
 * Файлы из drag&drop, включая рекурсивный обход папок (webkitGetAsEntry).
 * Каждому файлу проставляется relativePath — сервер восстановит структуру.
 */
export async function filesFromDataTransfer(dt: DataTransfer): Promise<PendingFile[]> {
  const out: PendingFile[] = [];
  const items = Array.from(dt.items ?? []);

  // webkitGetAsEntry действует только в текущем тике события — снимаем снапшот
  const entries = items
    .map((it) => (typeof it.webkitGetAsEntry === 'function' ? it.webkitGetAsEntry() : null))
    .filter((e): e is FileSystemEntry => e !== null);

  if (entries.length === 0) {
    for (const f of Array.from(dt.files ?? [])) {
      out.push(f as PendingFile);
    }
    return out;
  }

  const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    if (entry.isFile) {
      const file = await fileOf(entry as FileSystemFileEntry);
      const withPath = file as PendingFile;
      withPath.relativePath = prefix === '' ? file.name : `${prefix}/${file.name}`;
      out.push(withPath);
    } else if (entry.isDirectory) {
      const dir = entry as FileSystemDirectoryEntry;
      const children = await readDirAll(dir);
      for (const child of children) await walk(child, prefix === '' ? dir.name : `${prefix}/${dir.name}`);
    }
  };

  for (const entry of entries) await walk(entry, '');
  return out;
}

function fileOf(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

function readDirAll(dir: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  return new Promise((resolve) => {
    const reader = dir.createReader();
    const all: FileSystemEntry[] = [];
    // readEntries отдаёт страницу ~100 записей: читаем до пустого ответа
    const step = () =>
      reader.readEntries(
        (batch) => {
          if (batch.length === 0) {
            resolve(all);
            return;
          }
          all.push(...Array.from(batch));
          step();
        },
        () => resolve(all),
      );
    step();
  });
}

/** Файлы из <input type="file">: у выбора папки уже есть webkitRelativePath. */
export function filesFromInput(input: HTMLInputElement): PendingFile[] {
  return Array.from(input.files ?? []).map((f) => {
    const pf = f as PendingFile;
    const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath;
    pf.relativePath = rel && rel !== '' ? rel : f.name;
    return pf;
  });
}

const GENERIC_PASTE_NAME = /^(image|unknown|paste|blob|screenshot)([.-]|$)/i;

/**
 * Вставленная из буфера картинка: браузер даёт безликое «image.png» —
 * даём понятное имя с датой, как скриншот.
 */
export function pastedFile(file: File): PendingFile {
  if (!file.type.startsWith('image/') || !GENERIC_PASTE_NAME.test(file.name)) {
    return file as PendingFile;
  }
  const subtype = file.type.match(/^image\/(\w+)$/)?.[1] ?? 'png';
  const ext = subtype === 'jpeg' ? 'jpg' : subtype;
  const d = new Date();
  const p = (x: number) => String(x).padStart(2, '0');
  const name = `Вставлено ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}.${ext}`;
  return new File([file], name, { type: file.type, lastModified: file.lastModified }) as PendingFile;
}
