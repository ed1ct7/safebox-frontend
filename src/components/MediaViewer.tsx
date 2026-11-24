import { useEffect, useRef, useState } from 'react';
import type { MutableRefObject, PointerEvent } from 'react';
import { mediaUrl } from '../api/endpoints';
import type { Entry, EntryPatch } from '../api/types';
import { isInteractiveTarget, isTypingTarget, triggerDownload } from '../lib/dom';
import { displayName } from '../lib/link';
import { embedState, embedUrl, parseYouTube, watchUrl } from '../lib/youtube';
import type { EmbedState, YouTubeVideo } from '../lib/youtube';
import { useWindowEvent } from '../hooks/useEvent';
import { useTagCatalog } from '../hooks/useTagCatalog';
import { Modal } from './Modal';
import { ViewerTags } from './ViewerTags';

const MIN_SCALE = 0.15; // 15%
const MAX_SCALE = 6; // 600%
const WHEEL_STEP = 1.15;

interface View {
  scale: number;
  x: number;
  y: number;
}

const FIT: View = { scale: 1, x: 0, y: 0 };

/** Что листает просмотрщик: фото, видео и ролики YouTube (ссылки). */
export function isViewable(entry: Entry): boolean {
  return entry.kind === 'photo' || entry.kind === 'video' || (entry.kind === 'link' && parseYouTube(entry.url) !== null);
}

function labelOf(entry: Entry): string {
  if (entry.kind === 'photo') return 'Просмотр фото';
  if (entry.kind === 'video') return 'Просмотр видео';
  return 'Просмотр ролика';
}

/**
 * Полноэкранный просмотр (UF-4, UF-5, Ф4): ←/→ по фото, видео и роликам YouTube
 * текущего вида; Delete - в корзину, на место встаёт следующее; пробел на фото
 * закрывает (быстрый просмотр), на видео - пауза. Фото: колесо - зум 15–600%,
 * перетаскивание увеличенного, двойной клик - 100%/200%. Слева - панель тегов и
 * описания (🏷 возвращает). Esc или клик мимо - выход.
 */
export function MediaViewer({
  items,
  index,
  onIndex,
  onClose,
  onActivity,
  sourceNames,
  onOpenSource,
  onFilterTag,
  onSavePatch,
  onDelete,
}: {
  items: Entry[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  onActivity: () => void;
  sourceNames?: ReadonlyMap<number, string>;
  onOpenSource?: (id: number) => void;
  onFilterTag?: (tagId: number) => void;
  onSavePatch?: (id: number, patch: EntryPatch) => Promise<void>;
  /** Delete в просмотре: текущая запись - в корзину (без вопроса, Ctrl+Z вернёт) */
  onDelete?: (entry: Entry) => void;
}) {
  const [view, setView] = useState<View>(FIT);
  const [broken, setBroken] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(true); // панель тегов открывается вместе с просмотром
  const stageRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const entry = items[index];

  useEffect(() => {
    setView(FIT);
    setBroken(false);
  }, [entry?.id]);

  const go = (delta: number) => {
    if (items.length < 2) return;
    onIndex((index + delta + items.length) % items.length);
    onActivity();
  };

  useWindowEvent('keydown', (e) => {
    if (isTypingTarget(e.target) || entry === undefined) return; // стрелки в поле тегов листают подсказки
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    // фокус на <video> (щёлкнули по его панели): стрелки и пробел - его собственные (перемотка, пауза)
    const media = e.target instanceof HTMLMediaElement;
    if (e.key === 'ArrowLeft' && !media) go(-1);
    else if (e.key === 'ArrowRight' && !media) go(1);
    else if (e.key === 'Delete' && onDelete !== undefined) {
      e.preventDefault();
      if (!e.repeat) onDelete(entry); // зажатый Delete не стирает ленту подряд
    } else if (e.key === ' ' && !media && !isInteractiveTarget(e.target)) {
      e.preventDefault();
      if (e.repeat) return;
      if (entry.kind === 'photo') onClose();
      else if (entry.kind === 'video') {
        const v = videoRef.current;
        if (v !== null) void (v.paused ? v.play().catch(() => undefined) : v.pause());
      }
    }
  });

  // React вешает wheel как passive — для preventDefault нужен свой listener
  const isPhoto = entry?.kind === 'photo';
  useEffect(() => {
    const el = stageRef.current;
    if (el === null || !isPhoto) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const k = e.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP;
      setView((v) => {
        const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * k));
        return scale <= 1 ? { scale, x: 0, y: 0 } : { ...v, scale };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [isPhoto]);

  if (entry === undefined) return null;

  const onPointerDown = (e: PointerEvent<HTMLImageElement>) => {
    if (view.scale <= 1 || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, x: view.x, y: view.y };
  };
  const onPointerMove = (e: PointerEvent<HTMLImageElement>) => {
    const d = drag.current;
    if (d === null) return;
    setView((v) => ({ ...v, x: d.x + e.clientX - d.px, y: d.y + e.clientY - d.py }));
  };
  const endDrag = () => {
    drag.current = null;
  };

  const yt = entry.kind === 'link' ? parseYouTube(entry.url) : null;

  const arrowBtn =
    'absolute top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-zinc-900/80 text-xl text-zinc-200 transition hover:bg-zinc-800';
  const headBtn = 'shrink-0 rounded p-1.5 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100';

  return (
    <Modal onClose={onClose} className="flex bg-black/95" label={labelOf(entry)}>
      {tagsOpen && sourceNames !== undefined && onOpenSource !== undefined && (
        <ViewerTags
          entry={entry}
          sourceNames={sourceNames}
          onOpenSource={onOpenSource}
          onFilterTag={onFilterTag}
          onSavePatch={onSavePatch}
          onClose={() => setTagsOpen(false)}
        />
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 px-4 py-3">
          {!tagsOpen && (
            <button
              type="button"
              aria-label="Показать панель тегов"
              title="Показать панель тегов и описания"
              className={headBtn}
              onClick={() => setTagsOpen(true)}
            >
              🏷
            </button>
          )}
          <span className="min-w-0 flex-1 truncate text-sm text-zinc-300">{displayName(entry)}</span>
          {entry.kind === 'photo' && (
            <span className="shrink-0 text-xs tabular-nums text-zinc-500">{Math.round(view.scale * 100)}%</span>
          )}
          {yt !== null && (
            <a
              href={watchUrl(yt)}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 rounded px-2 py-1 text-xs text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100"
            >
              Открыть на YouTube ↗
            </a>
          )}
          <span className="shrink-0 text-xs tabular-nums text-zinc-500">
            {index + 1} / {items.length}
          </span>
          {onDelete !== undefined && (
            <button
              type="button"
              aria-label="В корзину (Delete)"
              title="В корзину (Delete) · Ctrl+Z - вернуть"
              className={headBtn}
              onClick={() => onDelete(entry)}
            >
              🗑
            </button>
          )}
          <button type="button" aria-label="Закрыть (Esc)" className={headBtn} onClick={onClose}>
            ✕
          </button>
        </div>
        <div
          ref={stageRef}
          data-dismiss=""
          className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden"
        >
          {entry.kind === 'photo' ? (
            broken ? (
              <p className="text-sm text-zinc-400">Не удалось загрузить фото</p>
            ) : (
              <img
                key={entry.id}
                src={mediaUrl(entry.id, 'content')}
                alt={entry.name}
                draggable={false}
                style={{
                  transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
                  cursor: view.scale > 1 ? 'grab' : 'default',
                }}
                onError={() => setBroken(true)}
                onDoubleClick={() => setView((v) => (v.scale > 1 ? FIT : { scale: 2, x: 0, y: 0 }))}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                className="max-h-full max-w-full select-none object-contain"
              />
            )
          ) : entry.kind === 'video' ? (
            <VideoStage key={entry.id} entry={entry} videoRef={videoRef} onActivity={onActivity} />
          ) : yt !== null ? (
            <YouTubeStage key={entry.id} entry={entry} video={yt} />
          ) : null}
          {items.length > 1 && (
            <>
              <button type="button" className={`${arrowBtn} left-3`} aria-label="Предыдущее (←)" onClick={() => go(-1)}>
                ‹
              </button>
              <button type="button" className={`${arrowBtn} right-3`} aria-label="Следующее (→)" onClick={() => go(1)}>
                ›
              </button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

/**
 * Плеер (UF-5): автозапуск, звук 80%, перемотка — сервер отдаёт Range-куски.
 * При уходе с видео поток обрывается явно: пока браузер держит соединение,
 * сервер держит аренду сессии, и блокировка ждала бы её освобождения.
 */
function VideoStage({
  entry,
  videoRef,
  onActivity,
}: {
  entry: Entry;
  videoRef: MutableRefObject<HTMLVideoElement | null>;
  onActivity: () => void;
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    return () => {
      if (video === null) return;
      video.pause();
      video.removeAttribute('src');
      video.load(); // обрывает загрузку
    };
  }, [videoRef]);

  if (failed) {
    return (
      <div className="flex flex-col items-center gap-3 text-center">
        <p className="text-sm text-zinc-300">Браузер не может воспроизвести этот формат.</p>
        <button
          type="button"
          className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white transition hover:bg-accent-hover"
          onClick={() => triggerDownload(mediaUrl(entry.id, 'download'))}
        >
          Скачать
        </button>
      </div>
    );
  }
  return (
    <video
      ref={videoRef}
      src={mediaUrl(entry.id, 'content')}
      controls
      autoPlay
      playsInline
      onLoadedMetadata={(e) => {
        e.currentTarget.volume = 0.8;
      }}
      onTimeUpdate={onActivity}
      onError={() => setFailed(true)}
      className="max-h-full max-w-full p-4"
    />
  );
}

function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useWindowEvent('online', () => setOnline(true));
  useWindowEvent('offline', () => setOnline(false));
  return online;
}

const EMBED_TEXT: Record<Exclude<EmbedState, 'ok'>, string> = {
  noembed: 'Автор запретил встраивание - ролик открывается только на YouTube.',
  gone: 'Ролик недоступен на YouTube (удалён или скрыт). Осталась обложка.',
};

/**
 * Ролик YouTube прямо в окне (youtube-nocookie). Запрет встраивания и
 * «недоступно» (теги из загрузки архива), а без сети - только обложка и ссылка.
 * Referer нужен плееру YouTube (без него ошибка 153), а у страницы сейфа
 * no-referrer: для фрейма уходит только origin.
 */
function YouTubeStage({ entry, video }: { entry: Entry; video: YouTubeVideo }) {
  const catalog = useTagCatalog();
  const online = useOnline();
  const state = embedState(entry, catalog);
  const frame = video.short ? 'aspect-[9/16] h-full max-h-full' : 'aspect-video w-full max-w-full max-h-full';

  if (state === 'ok' && online) {
    return (
      // поля по бокам - под кнопки ‹ ›, чтобы они не закрывали края плеера
      <div className="relative flex h-full w-full items-center justify-center px-16 pb-7 pt-4">
        <iframe
          title={displayName(entry)}
          src={embedUrl(video)}
          className={`${frame} rounded-lg bg-black`}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
        {/* фрейм чужого сайта забирает клавиатуру себе - окно её не слышит */}
        <p className="absolute inset-x-0 bottom-1 text-center text-[11px] text-zinc-500">
          Плеер забирает клавиши после щелчка по нему - щёлкните мимо, и ← → Delete снова работают
        </p>
      </div>
    );
  }
  const reason = state === 'ok' ? 'Нет сети - показана сохранённая обложка.' : EMBED_TEXT[state];
  return (
    <div className="flex max-h-full flex-col items-center gap-3 p-4 text-center">
      {entry.hasThumbnail ? (
        <img
          src={mediaUrl(entry.id, 'thumbnail')}
          alt={displayName(entry)}
          draggable={false}
          className="max-h-[60vh] max-w-full rounded-lg object-contain"
        />
      ) : (
        <span className="text-6xl opacity-40">▶</span>
      )}
      <p className="text-sm text-zinc-300">{reason}</p>
      {online && (
        <a
          href={watchUrl(video)}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white transition hover:bg-accent-hover"
        >
          Открыть на YouTube
        </a>
      )}
    </div>
  );
}
