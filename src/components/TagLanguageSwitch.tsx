import type { TagLanguage } from '../api/types';
import { useTagLanguage } from '../hooks/useTagLanguage';

const LANGUAGES: readonly TagLanguage[] = ['ru', 'en'];

/**
 * Переключатель языка имён тегов и категорий (настройка tagLanguage). Один и тот же
 * в настройках («Русский» / «English») и над каталогом в левой колонке (компактный
 * «RU» / «EN»): оба пишут одну настройку. Интерфейс от выбора не меняется.
 */
export function TagLanguageSwitch({
  labels,
  compact = false,
}: {
  labels: Readonly<Record<TagLanguage, string>>;
  compact?: boolean;
}) {
  const { lang, ready, setLang } = useTagLanguage();
  return (
    <div
      role="radiogroup"
      aria-label="Язык тегов"
      title="На каком языке показывать названия тегов и категорий (если английского нет — основное)"
      className="inline-flex shrink-0 overflow-hidden rounded-md border border-zinc-700"
    >
      {LANGUAGES.map((value) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={lang === value}
          disabled={!ready}
          className={`transition disabled:opacity-50 ${compact ? 'px-1.5 text-[10px] leading-5' : 'px-2.5 py-1 text-xs'} ${
            lang === value ? 'bg-accent/30 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
          }`}
          onClick={() => setLang(value)}
        >
          {labels[value]}
        </button>
      ))}
    </div>
  );
}
