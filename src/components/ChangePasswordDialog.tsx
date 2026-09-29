import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { changePassword } from '../api/endpoints';
import { errorMessage } from '../api/client';
import { validateNewPassword } from '../lib/rules';
import { DialogPanel, Modal } from './Modal';
import { useToast } from './Toasts';

const fieldClass =
  'w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-accent';

/**
 * UF-12: старый → новый → повтор. Сервер перешифровывает только конверт ключа,
 * сессия продолжает работать. Пароли живут в состоянии диалога и исчезают
 * вместе с ним.
 */
export function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [oldPassword, setOld] = useState('');
  const [newPassword, setNew] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => changePassword(oldPassword, newPassword, confirm),
    onSuccess: () => {
      toast('Пароль изменён', 'success');
      onClose();
    },
    onError: (e) => setError(errorMessage(e, 'Не удалось сменить пароль')),
  });

  const submit = () => {
    if (mutation.isPending) return;
    if (oldPassword === '') {
      setError('Введите текущий пароль');
      return;
    }
    const invalid = validateNewPassword(newPassword, confirm);
    if (invalid !== null) {
      setError(invalid);
      return;
    }
    setError(null);
    mutation.mutate();
  };

  return (
    <Modal onClose={onClose} label="Смена пароля">
      <DialogPanel title="Смена пароля">
        <form
          className="mt-4 flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-zinc-400">Текущий пароль</span>
            <input
              type="password"
              autoFocus
              autoComplete="current-password"
              className={fieldClass}
              value={oldPassword}
              onChange={(e) => setOld(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-zinc-400">Новый пароль</span>
            <input
              type="password"
              autoComplete="new-password"
              className={fieldClass}
              value={newPassword}
              onChange={(e) => setNew(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-zinc-400">Повторите новый пароль</span>
            <input
              type="password"
              autoComplete="new-password"
              className={fieldClass}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </label>
          {error !== null && (
            <p role="alert" className="text-sm text-red-400">
              {error}
            </p>
          )}
          <div className="mt-1 flex justify-end gap-2">
            <button
              type="button"
              className="rounded-lg px-3 py-1.5 text-sm text-zinc-400 transition hover:text-zinc-200"
              onClick={onClose}
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white transition hover:bg-accent-hover disabled:opacity-50"
            >
              Сменить
            </button>
          </div>
        </form>
      </DialogPanel>
    </Modal>
  );
}
