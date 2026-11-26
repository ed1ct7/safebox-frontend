import { useState } from 'react';
import { errorMessage, isUnauthorized } from '../api/client';
import { validateEntryName } from '../lib/rules';
import { DialogPanel, Modal } from './Modal';

/**
 * Имя папки: новая подпапка или переименование из меню дерева. onSubmit бросает -
 * ошибка сервера остаётся в диалоге, имя можно поправить.
 */
export function NameDialog({
  title,
  initial = '',
  submitLabel,
  hint,
  onSubmit,
  onClose,
}: {
  title: string;
  initial?: string;
  submitLabel: string;
  hint?: string;
  onSubmit: (name: string) => Promise<void>;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = value.trim();
  const invalid = name === '' ? 'Введите имя' : validateEntryName(name);
  const unchanged = initial !== '' && name === initial;

  const submit = async () => {
    if (busy || invalid !== null) return;
    if (unchanged) {
      onClose();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(name);
      onClose();
    } catch (e) {
      if (isUnauthorized(e)) return;
      setError(errorMessage(e, 'Не получилось'));
      setBusy(false);
    }
  };

  const shown = error ?? (touched ? invalid : null);
  return (
    <Modal onClose={onClose} label={title}>
      <DialogPanel title={title}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <input
            type="text"
            autoFocus
            aria-label="Имя"
            value={value}
            spellCheck={false}
            aria-invalid={invalid !== null}
            onChange={(e) => {
              setValue(e.target.value);
              setTouched(true);
              setError(null);
            }}
            onFocus={(e) => e.currentTarget.select()}
            className="mt-4 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-accent"
          />
          {hint !== undefined && <p className="mt-1.5 text-xs text-zinc-500">{hint}</p>}
          {shown !== null && (
            <p role="alert" className="mt-2 text-sm text-red-300">
              {shown}
            </p>
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
              type="submit"
              disabled={busy || invalid !== null}
              className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white transition hover:bg-accent-hover disabled:opacity-50"
            >
              {submitLabel}
            </button>
          </div>
        </form>
      </DialogPanel>
    </Modal>
  );
}
