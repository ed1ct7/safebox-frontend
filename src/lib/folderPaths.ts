import type { FolderNode } from '../api/types';
import { foldForSearch } from './fold';

// Пути папок для палитры «Переместить в…»: поиск по всему пути с «ё = е» и без
// регистра. «мем жив» находит «Мемы / Животные»: каждое слово запроса должно
// встретиться где-то в пути.

export interface FolderPath {
  id: number;
  name: string;
  /** имена от корня до самой папки */
  names: string[];
  /** «Мемы / Животные» */
  label: string;
  /** сегменты пути, свёрнутые для поиска */
  folded: string[];
}

export const PATH_SEPARATOR = ' / ';

/** Пути всех папок в порядке дерева (родитель, потом его дети по имени). */
export function folderPaths(folders: readonly FolderNode[]): FolderPath[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const children = new Map<number | null, FolderNode[]>();
  for (const f of folders) {
    // сирота (родитель не в списке) показывается от корня
    const parent = f.parentId !== null && byId.has(f.parentId) ? f.parentId : null;
    const list = children.get(parent);
    if (list === undefined) children.set(parent, [f]);
    else list.push(f);
  }
  const collator = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' });
  const out: FolderPath[] = [];
  const seen = new Set<number>();
  const walk = (parent: number | null, names: string[]) => {
    const list = [...(children.get(parent) ?? [])].sort((a, b) => collator.compare(a.name, b.name));
    for (const f of list) {
      if (seen.has(f.id)) continue; // цикл в данных - не зависаем
      seen.add(f.id);
      const path = [...names, f.name];
      out.push({
        id: f.id,
        name: f.name,
        names: path,
        label: path.join(PATH_SEPARATOR),
        folded: path.map(foldForSearch),
      });
      walk(f.id, path);
    }
  };
  walk(null, []);
  return out;
}

/** Слова запроса: разделители - пробелы и «/». */
export function queryTokens(query: string): string[] {
  return foldForSearch(query)
    .split(/[\s/\\]+/)
    .filter((t) => t !== '');
}

/**
 * Папки, в пути которых есть все слова запроса, лучшие сверху: совпадение в имени
 * самой папки, с начала слова, по порядку пути; при равенстве - путь короче.
 */
export function searchFolderPaths(paths: readonly FolderPath[], query: string, limit = 50): FolderPath[] {
  const tokens = queryTokens(query);
  if (tokens.length === 0) return [];
  const scored: { p: FolderPath; score: number }[] = [];
  for (const p of paths) {
    let score = 0;
    let lastSeg = -1;
    let ok = true;
    for (const t of tokens) {
      // лучший сегмент для слова: последний (сама папка) и совпадение с начала
      let best = -1;
      let bestScore = -1;
      for (let i = 0; i < p.folded.length; i += 1) {
        const seg = p.folded[i] ?? '';
        const at = seg.indexOf(t);
        if (at < 0) continue;
        const s =
          (i === p.folded.length - 1 ? 4 : 0) +
          (at === 0 ? 2 : 0) +
          (seg === t ? 2 : 0) +
          (i >= lastSeg ? 1 : 0);
        if (s > bestScore) {
          bestScore = s;
          best = i;
        }
      }
      if (best < 0) {
        ok = false;
        break;
      }
      score += bestScore;
      lastSeg = best;
    }
    if (ok) scored.push({ p, score });
  }
  scored.sort((a, b) => b.score - a.score || a.p.names.length - b.p.names.length || a.p.label.length - b.p.label.length);
  return scored.slice(0, limit).map((s) => s.p);
}

/** Путь, введённый для новой папки («Мемы / Коты», «Мемы/Коты») -> «Мемы/Коты»; пустой - null. */
export function normalizeNewPath(query: string): string | null {
  const parts = query
    .split(/[/\\]/)
    .map((s) => s.trim())
    .filter((s) => s !== '');
  return parts.length === 0 ? null : parts.join('/');
}

/** Такой путь уже есть (без регистра, ё = е)? */
export function findPathExact(paths: readonly FolderPath[], path: string): FolderPath | undefined {
  const want = path.split('/').map(foldForSearch);
  return paths.find((p) => p.folded.length === want.length && p.folded.every((s, i) => s === want[i]));
}
