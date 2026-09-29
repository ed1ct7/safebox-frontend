import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { tagsQuery } from '../api/queries';
import { buildCatalog, EMPTY_CATALOG } from '../lib/tags';
import type { TagCatalog } from '../lib/tags';

// Каталог тегов (GET /tags) живёт в кэше TanStack Query; карточки, панель свойств,
// поля ввода и фильтр читают его из контекста. Без провайдера каталог пуст.

const TagCatalogContext = createContext<TagCatalog>(EMPTY_CATALOG);

export function TagCatalogProvider({ children }: { children: ReactNode }) {
  const query = useQuery(tagsQuery);
  const catalog = useMemo(() => buildCatalog(query.data?.categories), [query.data]);
  return <TagCatalogContext.Provider value={catalog}>{children}</TagCatalogContext.Provider>;
}

export function useTagCatalog(): TagCatalog {
  return useContext(TagCatalogContext);
}
