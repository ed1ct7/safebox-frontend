/** «категория: тег»: категория приглушена, чтобы имя тега читалось первым. */
export function TagText({ category, name }: { category: string; name: string }) {
  return (
    <>
      <span className="text-zinc-500">{category}:</span> {name}
    </>
  );
}

/** Рамка чипа тега; pale - унаследованный (бледный). */
export const chipClass = (pale = false) =>
  `inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
    pale
      ? 'border-zinc-800 bg-zinc-900/60 text-zinc-500 opacity-70'
      : 'border-zinc-700 bg-zinc-800 text-zinc-200'
  }`;

/** Маленькая кнопка внутри чипа: крестик, переключатель наследования. */
export const chipButtonClass =
  'shrink-0 rounded-full px-1 text-[11px] leading-none text-zinc-500 transition hover:bg-zinc-700 hover:text-zinc-100 disabled:pointer-events-none disabled:opacity-40';
