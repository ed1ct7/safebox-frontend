import { useEffect, useRef, useState } from 'react';
import { mediaUrl } from '../api/endpoints';
import type { Entry } from '../api/types';
import { triggerDownload } from '../lib/dom';
import { Modal } from './Modal';

/**
 * Плеер (UF-5): автозапуск, звук 80%, перемотка — сервер отдаёт Range-куски.
 * При закрытии поток обрывается явно: пока браузер держит соединение, сервер
 * держит аренду сессии, и блокировка ждала бы её освобождения.
 */
export function VideoModal({
  entry,
  onClose,
  onActivity,
}: {
  entry: Entry;
  onClose: () => void;
  onActivity: () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);

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
    <Modal onClose={onClose} className="flex flex-col bg-black/95" label="Просмотр видео">
      <div className="flex items-center gap-3 px-4 py-3">
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
    </Modal>
  );
}
