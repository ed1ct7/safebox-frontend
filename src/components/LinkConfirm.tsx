import type { Entry } from '../api/types';
import { displayName, isHttpUrl } from '../lib/link';
import { DialogPanel, Modal } from './Modal';

/** UF-6: без подтверждения внешняя страница не открывается. Enter — «Открыть». */
export function LinkConfirm({ entry, onClose }: { entry: Entry; onClose: () => void }) {
  const url = entry.url ?? '';
  // сервер пускает в сейф только http(s), но открываем всё равно лишь их
  const safe = isHttpUrl(url);
  return (
    <Modal onClose={onClose} label="Открыть внешнюю ссылку">
      <DialogPanel title="Открыть внешнюю ссылку?">
        <p className="mt-3 text-sm text-zinc-300">
          {displayName(entry)}
          {entry.domain !== undefined && <span className="text-zinc-500"> · {entry.domain}</span>}
        </p>
        <p className="mt-1 break-all text-sm text-accent-hover">{url}</p>
        {!safe && (
          <p className="mt-2 text-sm text-red-400">Адрес не http(s) — открывать небезопасно.</p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-lg px-3 py-1.5 text-sm text-zinc-400 transition hover:text-zinc-200"
            onClick={onClose}
          >
            Отмена
          </button>
          <button
            type="button"
            autoFocus
            disabled={!safe}
            className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white transition hover:bg-accent-hover disabled:opacity-40"
            onClick={() => {
              window.open(url, '_blank', 'noopener,noreferrer');
              onClose();
            }}
          >
            Открыть
          </button>
        </div>
      </DialogPanel>
    </Modal>
  );
}
