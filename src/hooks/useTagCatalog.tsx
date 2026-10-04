import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { settingsQuery, tagsQuery } from '../api/queries';
import { buildCatalog, EMPTY_CATALOG } from '../lib/tags';
import type { TagCatalog } from '../lib/tags';

// Каталог тегов (GET /tags) живёт в кэше TanStack Query; карточки, панель свойств,
// поля ввода и фильтр читают его из контекста. Без провайдера каталог пуст.
// Язык имён тегов - настройка tagLanguage (GET /settings), читается тут же, один раз
// на открытый сейф: каталог сразу считает подписи (label) на нужном языке, и смена
// языка (useTagLanguage обновляет кэш настроек) перерисовывает все теги разом.

const TagCatalogContext = createContext<TagCatalog>(EMPTY_CATALOG);

export function TagCatalogProvider({ children }: { children: ReactNode }) {
  const query = useQuery(tagsQuery);
  const settings = useQuery(settingsQuery);
  const lang = settings.data?.tagLanguage ?? 'ru'; // настроек нет (ещё не пришли, ошибка) - основные имена
  const catalog = useMemo(() => buildCatalog(query.data?.categories, lang), [query.data, lang]);
  return <TagCatalogContext.Provider value={catalog}>{children}</TagCatalogContext.Provider>;
}

export function useTagCatalog(): TagCatalog {
  return useContext(TagCatalogContext);
}
