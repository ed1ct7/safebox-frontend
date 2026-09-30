// Приписки к одинаковым именам «как в проводнике» (UF-9/UF-10): чистая логика
// без React - «имя.jpg» → «имя (2).jpg», «имя (3).jpg»…

import { foldForSearch } from './fold';

export interface NameChange {
  id: number;
  from: string;
  to: string;
}

/** «имя.jpg» → «имя (2).jpg»; точка в начале («.gitignore») - не расширение. */
export function withSuffix(name: string, n: number): string {
  const dot = name.lastIndexOf('.');
  if (dot > 0) return `${name.slice(0, dot)} (${n})${name.slice(dot)}`;
  return `${name} (${n})`;
}

/**
 * Плана приписок для выделения: одинаковые имена (без учёта регистра, «ё»=«е»)
 * группируются; первая запись группы имя сохраняет, остальные получают
 * « (2)», « (3)»… как в проводнике. Занятыми считаются имена всех записей
 * folderEntries (обычно всё содержимое открытой папки) и уже назначенные в
 * этом плане - приписка не наткнётся на существующий «имя (2)». Возвращаются
 * только реальные изменения; записи без дублей не трогаются.
 */
export function planSuffixRename(
  selected: readonly { id: number; name: string }[],
  folderEntries: readonly { name: string }[] = selected,
): NameChange[] {
  const groups = new Map<string, { id: number; name: string }[]>();
  for (const e of selected) {
    const key = foldForSearch(e.name);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [e]);
    else group.push(e);
  }

  const taken = new Set(folderEntries.map((e) => foldForSearch(e.name)));
  const changes: NameChange[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    group.forEach((e, i) => {
      if (i === 0) return; // первая в группе - как в проводнике, имя остаётся
      let n = i + 1;
      let candidate = withSuffix(e.name, n);
      while (taken.has(foldForSearch(candidate))) {
        n += 1;
        candidate = withSuffix(e.name, n);
      }
      taken.add(foldForSearch(candidate));
      changes.push({ id: e.id, from: e.name, to: candidate });
    });
  }
  return changes;
}
