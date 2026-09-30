import { useEffect, useRef, useState } from 'react';
import { mediaUrl } from '../api/endpoints';
import type { Entry, EntryPatch } from '../api/types';
import { isTypingTarget, triggerDownload } from '../lib/dom';
import { useWindowEvent } from '../hooks/useEvent';
import { Modal } from './Modal';
import { ViewerTags } from './ViewerTags';

/**
 * Плеер (UF-5): автозапуск, звук 80%, перемотка — сервер отдаёт Range-куски.
 * При закрытии поток обрывается явно: пока браузер держит соединение, сервер
 * держит аренду сессии, и блокировка ждала бы её освобождения. 🏷 открывает
 * слева панель тегов и описания записи (не выходя из просмотра); Delete
 * спрашивает подтверждение и удаляет запись.
 */
export function VideoModal({
  entry,
  onClose,
  onActivity,
  sourceNames,
  onOpenSource,
  onFilterTag,
  onSavePatch,
  onDeleteRequest,
}: {
  entry: Entry;
  onClose: () => void;
  onActivity: () => void;
  sourceNames?: ReadonlyMap<number, string>;
  onOpenSource?: (id: number) => void;
  onFilterTag?: (tagId: number) => void;
  onSavePatch?: (id: number, patch: EntryPatch) => Promise<void>;
  /** Delete в просмотре: спросить подтверждение и удалить запись */
  onDeleteRequest?: (entry: Entry) => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false); // кино без панели; 🏷 открывает

  useWindowEvent('keydown', (e) => {
    if (isTypingTarget(e.target) || e.key !== 'Delete' || onDeleteRequest === undefined) return;
    e.preventDefault();
    onDeleteRequest(entry);
  });

  useEffect(() => {
    const video = ref.current;
    return () => {
      if (video === null) return;
      video.pause();
      video.removeAttribute('src');
      video.load(); // обрывает загрузку
    };
  }, []);

  return (
    <Modal onClose={onClose} className="flex bg-black/95" label="Просмотр видео">
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
          <button
            type="button"
            aria-label="Закрыть (Esc)"
            className="rounded p-1.5 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        <div data-dismiss="" className="flex flex-1 items-center justify-center overflow-hidden p-4">
          {failed ? (
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
          ) : (
            <video
              ref={ref}
              src={mediaUrl(entry.id, 'content')}
              controls
              autoPlay
              playsInline
              onLoadedMetadata={(e) => {
                e.currentTarget.volume = 0.8;
              }}
              onTimeUpdate={onActivity}
              onError={() => setFailed(true)}
              className="max-h-full max-w-full"
            />
          )}
        </div>
      </div>
    </Modal>
  );
}
