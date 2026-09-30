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
 * План приписок для выделения - только настоящие конфликты: одинаковые имена
 * В ПРЕДЕЛАХ ОДНОЙ папки (без учёта регистра, «ё»=«е»). Одинаковые имена из
 * разных папок (частая картина в результатах поиска) не конфликтуют и не
 * трогаются. Первая запись группы имя сохраняет, остальные получают
 * « (2)», « (3)»… как в проводнике; свободность проверяется по именам
 * соседей той же папки (folderEntries), занятые пропускаются. Возвращаются
 * только реальные изменения.
 */
export function planSuffixRename(
  selected: readonly { id: number; name: string; parentId: number | null }[],
  folderEntries: readonly { name: string; parentId: number | null }[] = selected,
): NameChange[] {
  // группы: одинаковое имя у записей одной папки
  const groups = new Map<string, { id: number; name: string; parentId: number | null }[]>();
  for (const e of selected) {
    const key = `${e.parentId ?? '·'}|${foldForSearch(e.name)}`;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [e]);
    else group.push(e);
  }

  // занятые имена - по папкам отдельно: приписка не должна столкнуться только со соседями
  const takenByParent = new Map<number | '·', Set<string>>();
  for (const e of folderEntries) {
    const key = e.parentId ?? '·';
    let taken = takenByParent.get(key);
    if (taken === undefined) {
      taken = new Set();
      takenByParent.set(key, taken);
    }
    taken.add(foldForSearch(e.name));
  }

  const changes: NameChange[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const parentKey = group[0]?.parentId ?? '·';
    const taken = takenByParent.get(parentKey) ?? new Set<string>();
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
