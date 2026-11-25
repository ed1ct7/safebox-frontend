import type { Entry } from '../api/types';

/**
 * Аудио и текст в сейфе - обычные файлы (kind 'file'): вида записи для них нет, а mime
 * сервер ставит только части форматов (mp3, m4a, txt/md/log/csv), у остальных
 * application/octet-stream. Поэтому - mime или расширение имени.
 */

/** Что играет <audio> в Chromium/Edge (mid, wma, ape - нет: такие только скачать). */
const AUDIO_EXT = new Set(['mp3', 'm4a', 'm4b', 'aac', 'flac', 'wav', 'oga', 'ogg', 'opus', 'weba']);

const TEXT_EXT = new Set([
  'txt', 'text', 'md', 'markdown', 'log', 'csv', 'tsv', 'json', 'jsonl', 'xml', 'yaml', 'yml',
  'toml', 'ini', 'conf', 'cfg', 'properties', 'env', 'srt', 'vtt', 'sub', 'nfo', 'cue', 'm3u',
  'm3u8', 'html', 'htm', 'css', 'js', 'mjs', 'ts', 'tsx', 'jsx', 'py', 'sh', 'bat', 'cmd',
  'ps1', 'c', 'h', 'cpp', 'hpp', 'cc', 'cs', 'java', 'kt', 'go', 'rs', 'rb', 'php', 'lua',
  'sql', 'svg', 'drawio', 'sln', 'csproj', 'gitignore', 'tex', 'bib',
]);

/** Расширения, у которых текст читается как проза (перенос по словам, обычный шрифт). */
const PROSE_EXT = new Set(['txt', 'text', 'md', 'markdown', 'nfo']);

/** Расширение имени в нижнем регистре без точки; '' - нет. ".gitignore" -> "gitignore". */
export function extOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 || dot === name.length - 1 ? '' : name.slice(dot + 1).toLowerCase();
}

export function isAudio(entry: Entry): boolean {
  return entry.kind === 'file' && (entry.mime.startsWith('audio/') || AUDIO_EXT.has(extOf(entry.name)));
}

/** Не аудио: плейлист .m3u с mime audio/x-mpegurl - это аудио-запись, а не две сразу. */
export function isText(entry: Entry): boolean {
  return (
    entry.kind === 'file' &&
    !isAudio(entry) &&
    (entry.mime.startsWith('text/') || TEXT_EXT.has(extOf(entry.name)))
  );
}

export function isProse(entry: Entry): boolean {
  return PROSE_EXT.has(extOf(entry.name));
}

export function isMarkdown(entry: Entry): boolean {
  const ext = extOf(entry.name);
  return ext === 'md' || ext === 'markdown';
}

/** Длиннее - заметка открывается исходником (разбор и вёрстка мегабайтов разметки тормозят). */
export const MARKDOWN_RENDER_LIMIT = 512 * 1024;

/** Сколько байт текста показывает просмотр; дальше - «показано начало» и «Скачать». */
export const TEXT_LIMIT = 2 * 1024 * 1024;

export interface DecodedText {
  text: string;
  /** 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1251' */
  encoding: string;
  /** нули в тексте - это двоичный файл с текстовым расширением */
  binary: boolean;
}

/** UTF-16 без BOM: нули строго через байт (латиница, цифры, пробелы) - на нечётных = LE. */
function sniffUtf16(bytes: Uint8Array): 'utf-16le' | 'utf-16be' | null {
  const n = Math.min(bytes.length, 4096) & ~1;
  if (n < 4) return null;
  let evenZero = 0;
  let oddZero = 0;
  for (let i = 0; i < n; i += 2) {
    if (bytes[i] === 0) evenZero += 1;
    if (bytes[i + 1] === 0) oddZero += 1;
  }
  const pairs = n / 2;
  if (evenZero === 0 && oddZero * 3 >= pairs) return 'utf-16le';
  if (oddZero === 0 && evenZero * 3 >= pairs) return 'utf-16be';
  return null;
}

/**
 * Байты -> текст: BOM UTF-8/UTF-16, UTF-16 без BOM по нулям через байт, иначе UTF-8, а
 * если он не сходится - windows-1251 (старые русские txt). Единичные битые байты UTF-8
 * (обрубленный экспорт) не уводят весь файл в 1251: UTF-8 остаётся, пока замен (U+FFFD)
 * не больше 1 на 1000 символов - русский текст в 1251 как UTF-8 даёт их почти на каждой
 * букве. truncated - байты обрезаны по лимиту: незаконченный символ в конце отбрасывается
 * (stream), а не становится ошибкой.
 */
export function decodeText(bytes: Uint8Array, truncated: boolean): DecodedText {
  const opts = { stream: truncated };
  let text: string;
  let encoding: string;
  const utf16 =
    bytes[0] === 0xff && bytes[1] === 0xfe
      ? 'utf-16le'
      : bytes[0] === 0xfe && bytes[1] === 0xff
        ? 'utf-16be'
        : sniffUtf16(bytes);
  if (utf16 !== null) {
    encoding = utf16;
    text = new TextDecoder(encoding).decode(bytes, opts);
  } else {
    encoding = 'utf-8';
    try {
      text = new TextDecoder(encoding, { fatal: true }).decode(bytes, opts);
    } catch {
      text = new TextDecoder(encoding).decode(bytes, opts);
      let bad = 0;
      for (const ch of text) if (ch === '�') bad += 1;
      if (bad * 1000 > text.length) {
        encoding = 'windows-1251';
        text = new TextDecoder(encoding).decode(bytes, opts);
      }
    }
  }
  return { text, encoding, binary: text.slice(0, 8192).includes('\u0000') };
}
