import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { errorMessage } from '../api/client';

const fieldClass =
  'w-full rounded-lg border bg-zinc-950 px-2.5 py-1.5 text-sm text-zinc-100 outline-none transition placeholder-zinc-600 focus:border-accent';

/**
 * Поле, правимое на месте (UF-22): сохраняется при уходе из поля, Enter (в
 * многострочном - Ctrl+Enter) уводит из поля, Esc возвращает прежнее значение
 * без запроса. Отказ сервера (422) и ошибка проверки видны под полем; запись
 * при этом не меняется, а введённый текст остаётся - его можно поправить.
 */
export function EditableField({
  label,
  value,
  multiline = false,
  placeholder,
  validate,
  onSave,
}: {
  label: string;
  value: string;
  multiline?: boolean;
  placeholder?: string;
  /** проверка до запроса; null - в порядке */
  validate?: (text: string) => string | null;
  onSave: (text: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const focused = useRef(false);
  const saving = useRef(false);
  const cancelled = useRef(false);

  // значение обновилось на сервере (или у другой записи) - подхватываем, пока не правим сами
  useEffect(() => {
    if (!focused.current && !saving.current) setDraft(value);
  }, [value]);

  const commit = async () => {
    if (saving.current) return;
    // однострочное значение - без пробелов по краям; описание храним как ввели
    const text = multiline ? draft : draft.trim();
    if (text === value) {
      setDraft(value);
      setError(null);
      return;
    }
    const invalid = validate?.(text) ?? null;
    if (invalid !== null) {
      setError(invalid);
      return;
    }
    saving.current = true;
    try {
      await onSave(text);
      setError(null);
    } catch (e) {
      setError(errorMessage(e, 'Не удалось сохранить'));
    } finally {
      saving.current = false;
    }
  };

  const handlers = {
    value: draft,
    placeholder,
    'aria-invalid': error !== null,
    onFocus: () => {
      focused.current = true;
    },
    onChange: (e: { target: { value: string } }) => {
      setDraft(e.target.value);
      setError(null);
    },
    onBlur: () => {
      focused.current = false;
      if (cancelled.current) {
        cancelled.current = false;
        return;
      }
      void commit();
    },
    onKeyDown: (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation(); // Esc отменяет правку, а не закрывает панель
        cancelled.current = true;
        setDraft(value);
        setError(null);
        e.currentTarget.blur();
      } else if (e.key === 'Enter' && (!multiline || e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        e.currentTarget.blur();
      }
    },
    className: `${fieldClass} ${error !== null ? 'border-red-500' : 'border-zinc-700'}`,
  };

  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-zinc-400">{label}</span>
      {multiline ? (
        <textarea rows={4} spellCheck={false} {...handlers} className={`${handlers.className} resize-y`} />
      ) : (
        <input spellCheck={false} {...handlers} />
      )}
      {error !== null && (
        <p role="alert" className="mt-1 text-xs text-red-300">
          {error}
        </p>
      )}
    </label>
  );
}
