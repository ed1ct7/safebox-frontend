import { useEffect, useRef, useState } from 'react';
import { validateEntryName } from '../lib/name';

/**
 * Инлайн-переименование (F2 / ✎): вместо отдельного окна имя правится прямо
 * в карточке. Enter — применить, Escape — отменить, потеря фокуса — применить
 * (если имя корректно). Выделяется имя без расширения, как в проводнике.
 */
export function NameEditor({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    el.focus();
    const dot = initial.lastIndexOf('.');
    const end = dot > 0 ? dot : initial.length;
    el.setSelectionRange(0, end);
  }, [initial]);

  const finish = (mode: 'commit' | 'cancel') => {
    if (done.current) return;
    done.current = true;
    if (mode === 'cancel' || validateEntryName(value.trim()) !== null) onCancel();
    else onCommit(value.trim());
  };

  return (
    <input
      ref={ref}
      value={value}
      spellCheck={false}
      title={error ?? undefined}
      onChange={(e) => {
        setValue(e.target.value);
        setError(null);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          if (validateEntryName(value.trim()) === null) finish('commit');
          else setError(validateEntryName(value.trim()));
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          finish('cancel');
        }
      }}
      onBlur={() => (validateEntryName(value.trim()) === null ? finish('commit') : finish('cancel'))}
      onClick={(e) => e.stopPropagation()}
      className={`w-full rounded border bg-zinc-950 px-1.5 py-0.5 text-sm text-zinc-100 outline-none ${
        error !== null ? 'border-red-500' : 'border-accent'
      }`}
    />
  );
}
