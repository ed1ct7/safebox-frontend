import { useEffect, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { mediaUrl } from '../api/endpoints';
import type { Entry, EntryPatch } from '../api/types';
import { isTypingTarget } from '../lib/dom';
import { useWindowEvent } from '../hooks/useEvent';
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

/**
 * Полноэкранный просмотр фото (UF-4): ←/→ по всем фото текущего вида,
 * колесо — зум 15–600%, перетаскивание увеличенного фото, двойной клик —
 * 100%/200%, Esc или клик мимо фото — выход. Слева - панель тегов и
 * описания открытого фото (открывается вместе с просмотром, 🏷 возвращает).
 */
export function Lightbox({
  photos,
  index,
  onIndex,
  onClose,
  onActivity,
  sourceNames,
  onOpenSource,
  onFilterTag,
  onSavePatch,
}: {
  photos: Entry[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  onActivity: () => void;
  sourceNames?: ReadonlyMap<number, string>;
  onOpenSource?: (id: number) => void;
  onFilterTag?: (tagId: number) => void;
  onSavePatch?: (id: number, patch: EntryPatch) => Promise<void>;
}) {
  const [view, setView] = useState<View>(FIT);
  const [broken, setBroken] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(true); // панель тегов открывается вместе с просмотром
  const stageRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const entry = photos[index];

  useEffect(() => {
    setView(FIT);
    setBroken(false);
  }, [index]);

  const go = (delta: number) => {
    if (photos.length < 2) return;
    onIndex((index + delta + photos.length) % photos.length);
    onActivity();
  };

  useWindowEvent('keydown', (e) => {
    if (isTypingTarget(e.target)) return; // стрелки в поле тегов листают подсказки, не фото
    if (e.key === 'ArrowLeft') go(-1);
    else if (e.key === 'ArrowRight') go(1);
  });

  // React вешает wheel как passive — для preventDefault нужен свой listener
  useEffect(() => {
    const el = stageRef.current;
    if (el === null) return;
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
  }, []);

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

  const arrowBtn =
    'absolute top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-zinc-900/80 text-xl text-zinc-200 transition hover:bg-zinc-800';

  return (
    <Modal onClose={onClose} className="flex bg-black/95" label="Просмотр фото">
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
              className="shrink-0 rounded p-1.5 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100"
              onClick={() => setTagsOpen(true)}
            >
              🏷
            </button>
          )}
          <span className="min-w-0 flex-1 truncate text-sm text-zinc-300">{entry.name}</span>
          <span className="shrink-0 text-xs tabular-nums text-zinc-500">
            {Math.round(view.scale * 100)}%
          </span>
          <span className="shrink-0 text-xs tabular-nums text-zinc-500">
            {index + 1} / {photos.length}
          </span>
          <button
            type="button"
            aria-label="Закрыть (Esc)"
            className="rounded p-1.5 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        <div
          ref={stageRef}
          data-dismiss=""
          className="relative flex flex-1 items-center justify-center overflow-hidden"
        >
          {broken ? (
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
          )}
          {photos.length > 1 && (
            <>
              <button
                type="button"
                className={`${arrowBtn} left-3`}
                aria-label="Предыдущее фото (←)"
                onClick={() => go(-1)}
              >
                ‹
              </button>
              <button
                type="button"
                className={`${arrowBtn} right-3`}
                aria-label="Следующее фото (→)"
                onClick={() => go(1)}
              >
                ›
              </button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
