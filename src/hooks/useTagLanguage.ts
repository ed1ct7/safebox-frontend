import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { updateSettings } from '../api/endpoints';
import { errorMessage, isUnauthorized } from '../api/client';
import { settingsQuery } from '../api/queries';
import type { TagLanguage } from '../api/types';
import { useToast } from '../components/Toasts';

/**
 * Язык имён тегов и категорий (настройка tagLanguage): чтение из кэша настроек, смена -
 * PATCH /settings с одним полем. Выбор применяется сразу, не дожидаясь ответа (каталог
 * считает подписи из того же кэша); не удался - кэш возвращается к серверному значению
 * и показывается тост. ready - настройки уже прочитаны: до этого переключать нечего.
 */
export function useTagLanguage(): { lang: TagLanguage; ready: boolean; setLang: (lang: TagLanguage) => void } {
  const qc = useQueryClient();
  const toast = useToast();
  const settings = useQuery(settingsQuery);

  const save = useMutation({
    mutationFn: (tagLanguage: TagLanguage) => updateSettings({ tagLanguage }),
    onMutate: async (tagLanguage) => {
      await qc.cancelQueries({ queryKey: settingsQuery.queryKey }); // запоздавший GET не затрёт выбор
      const previous = qc.getQueryData(settingsQuery.queryKey);
      qc.setQueryData(settingsQuery.queryKey, (old) => (old === undefined ? old : { ...old, tagLanguage }));
      return { previous };
    },
    onSuccess: (data) => qc.setQueryData(settingsQuery.queryKey, data),
    onError: (e, _lang, context) => {
      if (context?.previous !== undefined) qc.setQueryData(settingsQuery.queryKey, context.previous);
      if (!isUnauthorized(e)) toast(errorMessage(e, 'Не удалось сохранить настройку'), 'error');
    },
  });

  return {
    lang: settings.data?.tagLanguage ?? 'ru',
    ready: settings.data !== undefined,
    setLang: (lang) => {
      if (lang !== (settings.data?.tagLanguage ?? 'ru')) save.mutate(lang);
    },
  };
}
