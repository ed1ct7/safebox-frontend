import { useEffect, useRef, useState } from 'react';
import { mediaUrl } from '../api/endpoints';
import type { Entry } from '../api/types';

const MIN_SCALE = 0.15; // 15%
const MAX_SCALE = 6; // 600%

/** Полноэкранный просмотр фото (UF-4): ←/→, зум колесом 15–600%, Esc — выход. */
export function Lightbox({
  photos,
  index,
  onIndex,
  onClose,
  onActivity,
}: {
  photos: Entry[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  onActivity: () => void;
}) {
  const [scale, setScale] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);
  const entry = photos[index];

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  useEffect(() => {
    setScale(1);
  }, [index]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        onIndex((index - 1 + photos.length) % photos.length);
        onActivity();
      } else if (e.key === 'ArrowRight') {
        onIndex((index + 1) % photos.length);
        onActivity();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, photos.length, onIndex, onActivity]);

  // React вешает wheel как passive — preventDefault нужен свой listener
  useEffect(() => {
    const el = containerRef.current;
    if (el === null) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const k = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      setScale((s) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s * k)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  if (entry === undefined) return null;

  const arrowBtn =
    'absolute top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-zinc-900/80 text-xl text-zinc-200 transition hover:bg-zinc-800';

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/95"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <span className="min-w-0 flex-1 truncate text-sm text-zinc-300">{entry.name}</span>
        <span className="shrink-0 text-xs text-zinc-500">
          {index + 1} / {photos.length}
        </span>
        <button
          className="rounded p-1.5 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100"
          onClick={onClose}
        >
          ✕
        </button>
      </div>
      <div
        ref={containerRef}
        className="relative flex flex-1 items-center justify-center overflow-hidden"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <img
          src={mediaUrl(entry.id, 'content')}
          alt={entry.name}
          draggable={false}
          style={{ transform: `scale(${scale})` }}
          onDoubleClick={() => setScale((s) => (s > 1 ? 1 : 2))}
          className="max-h-full max-w-full select-none object-contain"
        />
        {photos.length > 1 && (
          <>
            <button
              className={`${arrowBtn} left-3`}
              aria-label="Предыдущее фото"
              onClick={() => {
                onIndex((index - 1 + photos.length) % photos.length);
                onActivity();
              }}
            >
              ‹
            </button>
            <button
              className={`${arrowBtn} right-3`}
              aria-label="Следующее фото"
              onClick={() => {
                onIndex((index + 1) % photos.length);
                onActivity();
              }}
            >
              ›
            </button>
          </>
        )}
      </div>
    </div>
  );
}
