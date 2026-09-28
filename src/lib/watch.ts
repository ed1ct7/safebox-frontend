// Чистая логика наблюдения за папкой (без API браузера) — тестируется напрямую.

export interface WatchFile {
  name: string;
  size: number;
  mtime: number; // File.lastModified
}

export interface WatchState {
  /** отпечатки уже обработанных файлов (имя‖размер‖mtime) */
  known: Set<string>;
  /** сколько опросов подряд файл виден с неизменным отпечатком */
  sightings: Map<string, number>;
  /** первый опрос «заглатывает» существующие файлы без импорта */
  baselineDone: boolean;
}

export const EMPTY_WATCH: WatchState = {
  known: new Set(),
  sightings: new Map(),
  baselineDone: false,
};

const SKIP_EXT = /\.(crdownload|part|partial|tmp|download)$/i;
const SKIP_NAMES = new Set(['desktop.ini', '.ds_store', 'thumbs.db']);

/** Недогруженные и служебные файлы не импортируем. */
export function skipWatchName(name: string): boolean {
  return SKIP_EXT.test(name) || SKIP_NAMES.has(name.toLowerCase());
}

export function fpOf(f: WatchFile): string {
  return `${f.name}\u0000${f.size}\u0000${f.mtime}`;
}

/**
 * Один опрос папки. Первый опрос — baseline: всё существующее помечается
 * известным и не импортируется. Дальше файл импортируется, когда он два
 * опроса подряд виден с одинаковым отпечатком (скачивание закончено,
 * размер стабилен).
 */
export function processPoll(
  files: WatchFile[],
  state: WatchState,
): { toImport: WatchFile[]; state: WatchState } {
  const known = new Set(state.known);
  const sightings = new Map<string, number>();
  const toImport: WatchFile[] = [];

  if (!state.baselineDone) {
    for (const f of files) {
      if (!skipWatchName(f.name)) known.add(fpOf(f));
    }
    return { toImport, state: { known, sightings, baselineDone: true } };
  }

  for (const f of files) {
    if (skipWatchName(f.name)) continue;
    const fp = fpOf(f);
    if (known.has(fp)) continue;
    const count = (state.sightings.get(fp) ?? 0) + 1;
    if (count >= 2) {
      known.add(fp);
      toImport.push(f);
    } else {
      sightings.set(fp, count);
    }
  }

  return { toImport, state: { known, sightings, baselineDone: true } };
}
