import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { Category } from '../api/types';
import { ToastProvider } from '../components/Toasts';
import { TagCatalogProvider } from '../hooks/useTagCatalog';

// Общее для тестов тегов: каталог-образец и обёртка с кэшем запросов, тостами и каталогом.

export function makeCategories(): Category[] {
  return [
    {
      id: 10,
      name: 'character',
      tags: [
        { id: 1, categoryId: 10, name: 'eris greyrat', count: 3 },
        { id: 2, categoryId: 10, name: 'roxy migurdia', count: 1 },
      ],
    },
    { id: 20, name: 'language', tags: [{ id: 5, categoryId: 20, name: 'ru', count: 4 }] },
  ];
}

/** Обёртка для render: один QueryClient на весь тест (нужен и rerender). */
export function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={qc}>
        <ToastProvider>
          <TagCatalogProvider>{children}</TagCatalogProvider>
        </ToastProvider>
      </QueryClientProvider>
    );
  }
  return { qc, Wrapper };
}
