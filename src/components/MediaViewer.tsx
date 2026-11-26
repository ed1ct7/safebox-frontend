import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { MutableRefObject, PointerEvent } from 'react';
import { handleUnauthorized } from '../api/client';
import { mediaUrl } from '../api/endpoints';
import { decodeText, isAudio, isMarkdown, isProse, isText, MARKDOWN_RENDER_LIMIT, TEXT_LIMIT } from '../lib/fileView';
import type { DecodedText } from '../lib/fileView';
import { formatBytes } from '../lib/format';
import { digitOfKey } from '../lib/places';
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

/** «Место» в полосе просмотрщика: цифра, папка, короткое имя и полный путь. */
export interface PlaceChip {
  digit: number;
  id: number;
  label: string;
  title: string;
}

const NO_PLACES: readonly PlaceChip[] = [];

/** Полноэкранное сейчас видео (родной полный экран плеера). */
const videoFullscreen = () => document.fullscreenElement instanceof HTMLVideoElement;

// react-markdown - отдельный чанк: грузится при первой открытой заметке
const MarkdownView = lazy(() => import('./MarkdownView'));

/** Что листает просмотрщик: фото, видео, аудио, текстовые файлы и ролики YouTube (ссылки). */
export function isViewable(entry: Entry): boolean {
  return (
    entry.kind === 'photo' ||
    entry.kind === 'video' ||
    isAudio(entry) ||
    isText(entry) ||
    (entry.kind === 'link' && parseYouTube(entry.url) !== null)
  );
}

function labelOf(entry: Entry): string {
  if (entry.kind === 'photo') return 'Просмотр фото';
  if (entry.kind === 'video') return 'Просмотр видео';
  if (isAudio(entry)) return 'Прослушивание';
  if (isText(entry)) return 'Просмотр текста';
  return 'Просмотр ролика';
}

/**
 * Полноэкранный просмотр (UF-4, UF-5, Ф4): ←/→ по фото, видео, аудио, текстам и роликам
 * YouTube текущего вида; Delete - в корзину, на место встаёт следующее; пробел на фото
 * закрывает (быстрый просмотр), на видео и аудио - пауза, в тексте - листает его.
 * Аудио, доиграв, переходит к следующему аудио (плейлист папки). Фото: колесо - зум 15–600%,
 * перетаскивание увеличенного, двойной клик - 100%/200%. Слева - панель тегов и
 * описания (🏷 возвращает). Esc или клик мимо - выход.
 * Перемещение не выходя из просмотра: цифры 1–9 - в «Места», M - палитра «Переместить в…»;
 * перемещённое уходит из ленты, на его место встаёт следующее. Видео во весь экран после
 * перемещения цифрой снова открывается во весь экран.
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
  places = NO_PLACES,
  onMoveTo,
  onMovePick,
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
  places?: readonly PlaceChip[];
  /** переместить запись в папку; true - перемещено (лента уже без неё) */
  onMoveTo?: (entry: Entry, parentId: number) => Promise<boolean>;
  /** палитра «Переместить в…» для записи; true - перемещено */
  onMovePick?: (entry: Entry) => Promise<boolean>;
}) {
  const [view, setView] = useState<View>(FIT);
  const [broken, setBroken] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(true); // панель тегов открывается вместе с просмотром
  const stageRef = useRef<HTMLDivElement>(null);
  const mediaRef = useRef<HTMLMediaElement | null>(null); // <video> или <audio> текущей записи
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const refullscreen = useRef(false); // следующее видео - сразу во весь экран
  const moving = useRef(false);
  const entry = items[index];

  useEffect(() => {
    setView(FIT);
    setBroken(false);
    if (entry?.kind !== 'video') refullscreen.current = false; // VideoStage забирает флаг раньше
  }, [entry?.id, entry?.kind]);

  const moveTo = async (target: Entry, parentId: number) => {
    if (onMoveTo === undefined || moving.current || target.parentId === parentId) return;
    moving.current = true;
    refullscreen.current = videoFullscreen();
    try {
      if (!(await onMoveTo(target, parentId))) refullscreen.current = false;
    } finally {
      moving.current = false;
    }
    onActivity();
  };

  const pickTarget = async (target: Entry) => {
    if (onMovePick === undefined || moving.current) return;
    const wasFull = videoFullscreen();
    if (document.fullscreenElement !== null && document.fullscreenElement !== undefined) {
      await document.exitFullscreen().catch(() => undefined); // палитра поверх видео не видна
    }
    refullscreen.current = wasFull;
    if (!(await onMovePick(target))) refullscreen.current = false;
  };

  const go = (delta: number) => {
    if (items.length < 2) return;
    onIndex((index + delta + items.length) % items.length);
    onActivity();
  };

  useWindowEvent('keydown', (e) => {
    if (isTypingTarget(e.target) || entry === undefined) return; // стрелки в поле тегов листают подсказки
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    // фокус в диалоге поверх просмотра (палитра перемещения, «имя занято») - клавиши его
    const own = stageRef.current?.closest('[role="dialog"]') ?? null;
    const inDialog = e.target instanceof Element ? e.target.closest('[role="dialog"]') : null;
    if (inDialog !== null && inDialog !== own) return;
    // фокус на <video> (щёлкнули по его панели): стрелки и пробел - его собственные (перемотка, пауза)
    const media = e.target instanceof HTMLMediaElement;
    const digit = e.shiftKey ? undefined : digitOfKey(e.code);
    if (digit !== undefined && onMoveTo !== undefined) {
      // e.code: цифры верхнего ряда и цифрового блока на любой раскладке
      e.preventDefault();
      const place = places.find((p) => p.digit === digit);
      if (!e.repeat && place !== undefined) void moveTo(entry, place.id);
    } else if (e.code === 'KeyM' && !e.shiftKey && onMovePick !== undefined) {
      e.preventDefault();
      if (!e.repeat) void pickTarget(entry);
    } else if (e.key === 'ArrowLeft' && !media) go(-1);
    else if (e.key === 'ArrowRight' && !media) go(1);
    else if (e.key === 'Delete' && onDelete !== undefined) {
      e.preventDefault();
      if (!e.repeat) onDelete(entry); // зажатый Delete не стирает ленту подряд
    } else if (e.key === ' ' && !media && !isInteractiveTarget(e.target) && !isText(entry)) {
      e.preventDefault();
      if (e.repeat) return;
      if (entry.kind === 'photo') onClose();
      else if (entry.kind === 'video' || isAudio(entry)) {
        const v = mediaRef.current;
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
  // доиграло - следующее аудио после текущего (без круга: после последнего трека - тишина).
  // Не во время ввода в панели тегов/описания: поле сохраняется при потере фокуса в ту
  // запись, что открыта в этот момент, - черновик ушёл бы следующему треку.
  const nextAudio = () => {
    if (isTypingTarget(document.activeElement)) return;
    const next = items.findIndex((it, i) => i > index && isAudio(it));
    if (next >= 0) onIndex(next);
  };

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
            <VideoStage
              key={entry.id}
              entry={entry}
              mediaRef={mediaRef}
              onActivity={onActivity}
              autoFullscreen={refullscreen}
            />
          ) : isAudio(entry) ? (
            <AudioStage key={entry.id} entry={entry} mediaRef={mediaRef} onActivity={onActivity} onEnded={nextAudio} />
          ) : isText(entry) ? (
            <TextStage key={entry.id} entry={entry} />
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
        {onMoveTo !== undefined && (
          <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto px-4 pb-3 pt-1" aria-label="Переместить">
            {onMovePick !== undefined && (
              <button
                type="button"
                className={chipBtn}
                title="Найти папку по имени и переместить (M)"
                onClick={() => void pickTarget(entry)}
              >
                ⇄ Переместить… <kbd className={kbd}>M</kbd>
              </button>
            )}
            {places.length === 0 ? (
              <span className="text-xs text-zinc-600">
                Цифры 1–9 - «Места»: добавьте папку правым кликом в дереве или ☆ в окне перемещения
              </span>
            ) : (
              places.map((p) => {
                const here = p.id === entry.parentId;
                return (
                  <button
                    key={p.digit}
                    type="button"
                    disabled={here}
                    className={chipBtn}
                    title={here ? `${p.title} - уже здесь` : `Переместить в «${p.title}» (${p.digit})`}
                    onClick={() => void moveTo(entry, p.id)}
                  >
                    <kbd className={kbd}>{p.digit}</kbd> {p.label}
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

const chipBtn =
  'flex shrink-0 items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900/80 px-3 py-1 text-xs text-zinc-300 transition hover:border-zinc-600 hover:text-zinc-100 disabled:pointer-events-none disabled:opacity-35';
const kbd = 'rounded bg-zinc-800 px-1 font-mono text-[10px] text-zinc-400';

/**
 * При уходе с видео/аудио поток обрывается явно: пока браузер держит соединение,
 * сервер держит аренду сессии, и блокировка ждала бы её освобождения.
 * Только у элемента, уже убранного из документа: StrictMode (dev) прогоняет очистку
 * на живом элементе - без проверки плеер оставался без src.
 */
function useAbortOnLeave(mediaRef: MutableRefObject<HTMLMediaElement | null>) {
  useEffect(() => {
    const media = mediaRef.current;
    return () => {
      if (media === null || media.isConnected) return;
      media.pause();
      media.removeAttribute('src');
      media.load(); // обрывает загрузку
    };
  }, [mediaRef]);
}

function CannotShow({ entry, what }: { entry: Entry; what: string }) {
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <p className="text-sm text-zinc-300">{what}</p>
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

/** Плеер (UF-5): автозапуск, звук 80%, перемотка — сервер отдаёт Range-куски. */
function VideoStage({
  entry,
  mediaRef,
  onActivity,
  autoFullscreen,
}: {
  entry: Entry;
  mediaRef: MutableRefObject<HTMLMediaElement | null>;
  onActivity: () => void;
  /** true - открыть во весь экран сразу (предыдущее видео смотрели так и переместили цифрой) */
  autoFullscreen?: MutableRefObject<boolean>;
}) {
  const [failed, setFailed] = useState(false);
  useAbortOnLeave(mediaRef);

  useEffect(() => {
    if (autoFullscreen?.current !== true) return;
    autoFullscreen.current = false;
    const v = mediaRef.current;
    // браузер разрешает полный экран только вскоре после нажатия клавиши - не вышло, и ладно
    if (v instanceof HTMLVideoElement) void v.requestFullscreen?.()?.catch(() => undefined);
  }, [autoFullscreen, mediaRef]);

  if (failed) return <CannotShow entry={entry} what="Браузер не может воспроизвести этот формат." />;
  return (
    <video
      ref={(el) => {
        mediaRef.current = el;
      }}
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

/**
 * Аудио: обложка (миниатюра, если есть), имя и плеер. Автозапуск, звук 80%; доиграв -
 * onEnded (следующий трек). Формат, который браузер не играет, - «Скачать».
 */
function AudioStage({
  entry,
  mediaRef,
  onActivity,
  onEnded,
}: {
  entry: Entry;
  mediaRef: MutableRefObject<HTMLMediaElement | null>;
  onActivity: () => void;
  onEnded: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const [coverFailed, setCoverFailed] = useState(false);
  useAbortOnLeave(mediaRef);

  if (failed) return <CannotShow entry={entry} what="Браузер не может воспроизвести этот аудиоформат." />;
  return (
    <div className="flex w-full max-w-xl flex-col items-center gap-5 px-16 py-4">
      {entry.hasThumbnail && !coverFailed ? (
        <img
          src={mediaUrl(entry.id, 'thumbnail')}
          alt=""
          draggable={false}
          onError={() => setCoverFailed(true)}
          className="max-h-[45vh] max-w-full rounded-lg object-contain shadow-lg"
        />
      ) : (
        <div className="flex h-40 w-40 items-center justify-center rounded-2xl bg-zinc-900 text-7xl text-zinc-500">
          ♪
        </div>
      )}
      <p className="max-w-full truncate text-center text-sm text-zinc-300">{displayName(entry)}</p>
      <audio
        ref={(el) => {
          mediaRef.current = el;
        }}
        src={mediaUrl(entry.id, 'content')}
        controls
        autoPlay
        onLoadedMetadata={(e) => {
          e.currentTarget.volume = 0.8;
        }}
        onTimeUpdate={onActivity}
        onEnded={onEnded}
        onError={() => setFailed(true)}
        className="w-full"
      />
    </div>
  );
}

/**
 * Первые limit байт ответа потоком: тело больше лимита (сервер не понял Range) не
 * читается целиком в память. more - за лимитом есть ещё (поток после этого отменён).
 */
async function readHead(res: Response, limit: number): Promise<{ bytes: Uint8Array; more: boolean }> {
  if (res.body === null) {
    const all = new Uint8Array(await res.arrayBuffer());
    return { bytes: all.subarray(0, limit), more: all.length > limit };
  }
  const reader = res.body.getReader();
  const out = new Uint8Array(limit);
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return { bytes: out.subarray(0, got), more: false };
    const take = Math.min(value.length, limit - got);
    out.set(value.subarray(0, take), got);
    got += take;
    if (take < value.length) {
      void reader.cancel().catch(() => undefined);
      return { bytes: out.subarray(0, got), more: true };
    }
  }
}

type TextState =
  | { status: 'loading' }
  | { status: 'failed' }
  | ({ status: 'ready'; truncated: boolean } & DecodedText);

const ENCODING_LABELS: Partial<Record<string, string>> = {
  'utf-16le': 'UTF-16',
  'utf-16be': 'UTF-16 BE',
  'windows-1251': 'Windows-1251',
};

/**
 * Текстовый файл: первые TEXT_LIMIT байт (Range), кодировка - decodeText. Только текст
 * (дочерний текст <pre>) - html/svg из сейфа не исполняются и не рисуются; заметка .md -
 * с оформлением (MarkdownView: сырой HTML в ней не исполняется), «Исходный текст» - как есть. Область в
 * фокусе: колесо, ↑ ↓ PgUp PgDn и пробел листают текст; ← → по-прежнему листают записи.
 */
function TextStage({ entry }: { entry: Entry }) {
  const [state, setState] = useState<TextState>({ status: 'loading' });
  const [showSource, setShowSource] = useState<boolean | null>(null); // null - по размеру заметки
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    void (async () => {
      try {
        const res = await fetch(mediaUrl(entry.id, 'content'), {
          signal: ctrl.signal,
          headers: entry.size > TEXT_LIMIT ? { Range: `bytes=0-${TEXT_LIMIT - 1}` } : undefined,
        });
        if (res.status === 401) {
          handleUnauthorized(); // сессия кончилась - на экран входа, как любой запрос
          return;
        }
        if (!res.ok) throw new Error(String(res.status));
        const { bytes, more } = await readHead(res, TEXT_LIMIT);
        if (more) ctrl.abort(); // Range не понят (или размер записи устарел) - хвост не тянем
        const truncated = more || bytes.length < entry.size;
        setState({ status: 'ready', truncated, ...decodeText(bytes, truncated) });
      } catch {
        if (!ctrl.signal.aborted) setState({ status: 'failed' });
      }
    })();
    return () => ctrl.abort(); // ушли с записи - запрос обрывается (аренда сессии)
  }, [entry.id, entry.size]);

  const ready = state.status === 'ready' && !state.binary;
  useEffect(() => {
    // текст загрузился, пока пишут описание или тег, - фокус у поля не отнимается
    // (иначе Delete и стрелки ушли бы просмотрщику)
    if (ready && !isTypingTarget(document.activeElement)) boxRef.current?.focus({ preventScroll: true });
  }, [ready]);

  if (state.status === 'loading') return <p className="text-sm text-zinc-500">Загрузка…</p>;
  if (state.status === 'failed') return <CannotShow entry={entry} what="Не удалось загрузить файл." />;
  if (state.binary) return <CannotShow entry={entry} what="Это не текст: в файле двоичные данные." />;

  const encoding = ENCODING_LABELS[state.encoding];
  const markdown = isMarkdown(entry);
  // заметка - с оформлением; огромная - исходником (переключатель - в строке над текстом)
  const source = !markdown || (showSource ?? state.text.length > MARKDOWN_RENDER_LIMIT);
  return (
    <div className="flex h-full w-full flex-col items-center px-16 pb-4 pt-1">
      {(state.truncated || encoding !== undefined || markdown) && (
        <div className="mb-2 flex w-full max-w-4xl items-center gap-3 text-xs text-zinc-500">
          {markdown && (
            <button
              type="button"
              className="rounded px-2 py-0.5 text-zinc-300 transition hover:bg-zinc-800"
              onClick={() => {
                setShowSource(!source);
                boxRef.current?.focus({ preventScroll: true }); // пробел и стрелки - снова тексту
              }}
            >
              {source ? 'Оформление' : 'Исходный текст'}
            </button>
          )}
          {encoding !== undefined && <span>Кодировка: {encoding}</span>}
          {state.truncated && (
            <>
              <span>
                Показано начало: {formatBytes(TEXT_LIMIT)} из {formatBytes(entry.size)}
              </span>
              <button
                type="button"
                className="rounded px-2 py-0.5 text-zinc-300 transition hover:bg-zinc-800"
                onClick={() => triggerDownload(mediaUrl(entry.id, 'download'))}
              >
                Скачать целиком
              </button>
            </>
          )}
        </div>
      )}
      <div
        ref={boxRef}
        tabIndex={0}
        aria-label="Текст файла"
        className="min-h-0 w-full max-w-4xl flex-1 overflow-auto rounded-lg bg-zinc-900 px-6 py-5 outline-none focus-visible:ring-1 focus-visible:ring-zinc-700"
      >
        {source ? (
          <pre
            className={`whitespace-pre-wrap break-words text-zinc-200 ${
              isProse(entry) ? 'font-sans text-[15px] leading-relaxed' : 'font-mono text-[13px] leading-snug'
            }`}
          >
            {state.text}
          </pre>
        ) : (
          <Suspense fallback={<p className="text-sm text-zinc-500">Загрузка…</p>}>
            <MarkdownView text={state.text} />
          </Suspense>
        )}
      </div>
    </div>
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
