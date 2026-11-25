import { useState } from 'react';
import { errorMessage, isUnauthorized } from '../api/client';
import { createTable } from '../api/tables';
import { validateEntryName } from '../lib/rules';
import { TABLE_EXT, TEMPLATES } from '../lib/table';
import { DialogPanel, Modal } from './Modal';

/**
 * Новая таблица в открытой папке: название и заготовка столбцов. Столбцы потом
 * меняются как угодно - заготовка только избавляет от настройки с нуля.
 */
export function NewTableDialog({
  parentId,
  onCreated,
  onClose,
}: {
  parentId: number | null;
  /** id новой записи; null - сервер его не сообщил (таблица создана, откроется из папки) */
  onCreated: (id: number | null) => void;
  onClose: () => void;
}) {
  const [templateId, setTemplateId] = useState(TEMPLATES[0]!.id);
  const template = TEMPLATES.find((t) => t.id === templateId) ?? TEMPLATES[0]!;
  // пока название не трогали, оно следует за заготовкой
  const [typed, setTyped] = useState<string | null>(null);
  const title = (typed ?? template.title).trim();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const invalid = title === '' ? 'Введите название' : validateEntryName(`${title}${TABLE_EXT}`);

  const submit = async () => {
    if (busy || invalid !== null) return;
    setBusy(true);
    setError(null);
    try {
      const id = await createTable(parentId, title, template.make());
      onClose();
      onCreated(id);
    } catch (e) {
      if (isUnauthorized(e)) return;
      setError(errorMessage(e, 'Не удалось создать таблицу'));
      setBusy(false);
    }
  };

  return (
    <Modal onClose={onClose} label="Новая таблица">
      <DialogPanel title="Новая таблица">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <fieldset className="mt-4 space-y-1.5">
            <legend className="mb-1.5 text-xs text-zinc-500">Столбцы</legend>
            {TEMPLATES.map((t) => (
              <label
                key={t.id}
                className={`flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 transition ${
                  t.id === templateId ? 'border-accent bg-accent/10' : 'border-zinc-700 hover:border-zinc-500'
                }`}
              >
                <input
                  type="radio"
                  name="table-template"
                  className="mt-1 accent-indigo-500"
                  checked={t.id === templateId}
                  onChange={() => setTemplateId(t.id)}
                />
                <span className="min-w-0">
                  <span className="block text-sm text-zinc-100">{t.label}</span>
                  <span className="block text-xs text-zinc-500">{t.hint}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <label className="mt-4 block">
            <span className="mb-1.5 block text-xs text-zinc-500">Название</span>
            <input
              type="text"
              autoFocus
              value={typed ?? template.title}
              spellCheck={false}
              aria-invalid={invalid !== null}
              onChange={(e) => setTyped(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-accent"
            />
          </label>
          {(error ?? (typed !== null ? invalid : null)) !== null && (
            <p role="alert" className="mt-2 text-sm text-red-300">
              {error ?? invalid}
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
              {busy ? 'Создание…' : 'Создать'}
            </button>
          </div>
        </form>
      </DialogPanel>
    </Modal>
  );
}
