import { useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  assignTags,
  createCategory,
  createTag,
  deleteCategory,
  deleteTag,
  mergeTag,
  renameCategory,
  updateTag,
} from '../api/endpoints';
import { invalidateTags } from '../api/queries';
import type { TagRef } from '../api/types';
import type { ResolvedCreatePlan } from '../lib/tagInput';

/**
 * Мутации тегов (UF-16, UF-17). После каждой - успешной или нет - обновляются
 * каталог, карточки и результаты поиска: часть работы могла пройти до ошибки.
 * Ошибки (422, 409…) вызывающий показывает у своего поля.
 */
export function useTagActions() {
  const qc = useQueryClient();
  return useMemo(() => {
    const run = async <T>(fn: () => Promise<T>): Promise<T> => {
      try {
        return await fn();
      } finally {
        invalidateTags(qc);
      }
    };
    return {
      /** add - повесить или обновить inherit, remove - снять; у всех ids разом */
      assign: (ids: number[], change: { add?: TagRef[]; remove?: number[] }) =>
        run(() => assignTags(ids, change)),
      /** «Создать тег…» из поля ввода; новая категория - createCategory: true.
       * Категория всегда выбрана: поле отправляет сюда план уже после панели выбора. */
      createTag: (plan: ResolvedCreatePlan) =>
        run(() =>
          createTag({
            category: plan.category,
            name: plan.name,
            ...(plan.newCategory ? { createCategory: true } : {}),
          }),
        ),
      createCategory: (name: string) => run(() => createCategory(name)),
      renameCategory: (id: number, name: string) => run(() => renameCategory(id, name)),
      removeCategory: (id: number) => run(() => deleteCategory(id)),
      renameTag: (id: number, name: string) => run(() => updateTag(id, { name })),
      moveTag: (id: number, categoryId: number) => run(() => updateTag(id, { categoryId })),
      mergeTag: (from: number, into: number) => run(() => mergeTag(from, into)),
      removeTag: (id: number) => run(() => deleteTag(id)),
    };
  }, [qc]);
}
