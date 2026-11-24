import type { Entry } from '../api/types';
import { foldForSearch } from './fold';
import type { TagCatalog } from './tags';

/** Ролик YouTube по адресу ссылки: id, шортс ли он (кадр 9:16) и с какой секунды. */
export interface YouTubeVideo {
  id: string;
  short: boolean;
  start: number; // секунд; 0 - с начала
}

const ID = /^[A-Za-z0-9_-]{11}$/;
const HOSTS = new Set(['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com']);

/** «90», «90s», «1m30s», «1h2m3s» -> секунды; что-то другое - 0. */
export function parseStart(value: string | null): number {
  if (value === null || value === '') return 0;
  if (/^\d+$/.test(value)) return Number(value);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value);
  if (m === null || m[0] === '') return 0;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

/** watch?v=, youtu.be/, shorts/, live/, embed/, v/ на youtube.com и его зеркалах; иначе null. */
export function parseYouTube(url: string | undefined): YouTubeVideo | null {
  if (url === undefined) return null;
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const start = parseStart(u.searchParams.get('t') ?? u.searchParams.get('start'));
  const parts = u.pathname.split('/').filter((p) => p !== '');
  let id: string | undefined;
  let short = false;
  if (host === 'youtu.be') {
    id = parts[0];
  } else if (HOSTS.has(host)) {
    if (parts[0] === 'watch') id = u.searchParams.get('v') ?? undefined;
    else if (parts[0] === 'shorts' || parts[0] === 'live' || parts[0] === 'embed' || parts[0] === 'v') {
      id = parts[1];
      short = parts[0] === 'shorts';
    }
  }
  return id !== undefined && ID.test(id) ? { id, short, start } : null;
}

/** Плеер без cookies YouTube до нажатия «играть» (youtube-nocookie). */
export function embedUrl(v: YouTubeVideo, autoplay = true): string {
  const params = new URLSearchParams({ rel: '0', playsinline: '1' });
  if (autoplay) params.set('autoplay', '1');
  if (v.start > 0) params.set('start', String(v.start));
  return `https://www.youtube-nocookie.com/embed/${v.id}?${params.toString()}`;
}

/** Страница ролика для «Открыть на YouTube». */
export function watchUrl(v: YouTubeVideo): string {
  const base = v.short ? `https://www.youtube.com/shorts/${v.id}` : `https://www.youtube.com/watch?v=${v.id}`;
  return v.start > 0 && !v.short ? `${base}&t=${v.start}s` : base;
}

/**
 * Можно ли встроить: теги «YouTube / Без встраивания» и «YouTube / Недоступно»
 * (их ставит загрузка архива) - только обложка и ссылка.
 */
export type EmbedState = 'ok' | 'noembed' | 'gone';

const NOEMBED = foldForSearch('Без встраивания');
const GONE = foldForSearch('Недоступно');

export function embedState(entry: Pick<Entry, 'tags'>, catalog: TagCatalog): EmbedState {
  let state: EmbedState = 'ok';
  for (const ref of entry.tags) {
    const tag = catalog.tags.get(ref.tagId);
    if (tag === undefined || foldForSearch(tag.category) !== 'youtube') continue;
    const name = foldForSearch(tag.name);
    if (name === GONE) return 'gone';
    if (name === NOEMBED) state = 'noembed';
  }
  return state;
}
