import { useEffect, useRef, useState } from 'react';
import { validateEntryName } from '../lib/rules';

/**
 * Инлайн-переименование (F2 / ✎ / меню): имя правится прямо в карточке.
 * Enter — применить, Escape — отменить, потеря фокуса — применить, если имя
 * корректно. Выделяется имя без расширения, как в проводнике.
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
    el.setSelectionRange(0, dot > 0 ? dot : initial.length);
  }, [initial]);

  const finish = (commit: boolean) => {
    if (done.current) return;
    const name = value.trim();
    if (commit && validateEntryName(name) === null) {
      done.current = true;
      onCommit(name);
    } else {
      done.current = true;
      onCancel();
    }
  };

  return (
    <div className="relative">
      <input
        ref={ref}
        value={value}
        spellCheck={false}
        aria-label="Новое имя"
        aria-invalid={error !== null}
        onChange={(e) => {
          setValue(e.target.value);
          setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            const invalid = validateEntryName(value.trim());
            if (invalid === null) finish(true);
            else setError(invalid);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation(); // Escape отменяет правку, а не снимает выделение
            finish(false);
          }
        }}
        onBlur={() => finish(true)}
        onClick={(e) => e.stopPropagation()}
        className={`w-full rounded border bg-zinc-950 px-1.5 py-0.5 text-sm text-zinc-100 outline-none ${
          error !== null ? 'border-red-500' : 'border-accent'
        }`}
      />
      {error !== null && (
        <p
          role="alert"
          className="absolute left-0 top-full z-20 mt-1 w-max max-w-[16rem] rounded bg-red-950 px-2 py-1 text-xs text-red-200 shadow-lg"
        >
          {error}
        </p>
      )}
    </div>
  );
}
