import { DialogPanel, Modal } from './Modal';

export interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
}

/**
 * Подтверждение внутри страницы вместо window.confirm: нативный диалог
 * замораживает JS вкладки, пульс присутствия перестаёт уходить, и через
 * 2 минуты раздумий сервер блокирует сейф как «закрытое окно».
 * Enter — подтвердить (фокус на кнопке), Escape/клик мимо — отмена.
 */
export function ConfirmDialog({
  request,
  onClose,
}: {
  request: ConfirmRequest;
  onClose: () => void;
}) {
  return (
    <Modal onClose={onClose} label={request.title}>
      <DialogPanel title={request.title}>
        <p className="mt-3 whitespace-pre-line text-sm text-zinc-300">{request.message}</p>
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
            className={`rounded-lg px-4 py-1.5 text-sm font-medium text-white transition ${
              request.danger === true
                ? 'bg-red-600 hover:bg-red-500'
                : 'bg-accent hover:bg-accent-hover'
            }`}
            onClick={() => {
              onClose();
              request.onConfirm();
            }}
          >
            {request.confirmLabel}
          </button>
        </div>
      </DialogPanel>
    </Modal>
  );
}
