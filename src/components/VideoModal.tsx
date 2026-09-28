import { useEffect, useRef } from 'react';
import { mediaUrl } from '../api/endpoints';
import type { Entry } from '../api/types';

/** Плеер (UF-5): автозапуск, звук 80%, перемотка — сервер отдаёт Range-куски. */
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

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    if (ref.current !== null) ref.current.volume = 0.8;
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/95"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <span className="min-w-0 flex-1 truncate text-sm text-zinc-300">{entry.name}</span>
        <button
          className="rounded p-1.5 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100"
          onClick={onClose}
        >
          ✕
        </button>
      </div>
      <div className="flex flex-1 items-center justify-center overflow-hidden p-4">
        <video
          ref={ref}
          src={mediaUrl(entry.id, 'content')}
          controls
          autoPlay
          playsInline
          onTimeUpdate={onActivity}
          className="max-h-full max-w-full"
        />
      </div>
    </div>
  );
}
