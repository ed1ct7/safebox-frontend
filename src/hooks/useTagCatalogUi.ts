import { useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

// Состояние показа каталога тегов (какие категории свернуты, где раскрыт полный
// список): в localStorage, переживает перезапуск приложения. Ошибки чтения и
// записи молча игнорируются: состояние просто не сохранится (приватный режим,
// переполнение квоты) - это не то, о чём стоит сообщать пользователю.

export interface TagCatalogUiState {
  /** Категории, свернутые целиком. */
  collapsed: number[];
  /** Категории, раскрытые до полного списка (вместо лимита популярных). */
  full: number[];
}

const EMPTY: TagCatalogUiState = { collapsed: [], full: [] };

function ids(value: unknown): number[] {
  return Array.isArray(value)
    ? value.filter((x): x is number => typeof x === 'number' && Number.isFinite(x))
    : [];
}

function load(key: string): TagCatalogUiState {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return EMPTY;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return EMPTY;
    const record = parsed as Record<string, unknown>;
    return { collapsed: ids(record.collapsed), full: ids(record.full) };
  } catch {
    return EMPTY;
  }
}

/**
 * Состояние каталога под своим ключом; у левой колонки и панели фильтра оно
 * отдельное. Читается один раз при монтировании, дальше пишется при каждом
 * изменении.
 */
export function useTagCatalogUi(
  key: string,
): [TagCatalogUiState, Dispatch<SetStateAction<TagCatalogUiState>>] {
  const [state, setState] = useState<TagCatalogUiState>(() => load(key));
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch {
      // не сохранилось - состояние переживёт только до перезагрузки страницы
    }
  }, [key, state]);
  return [state, setState];
}
