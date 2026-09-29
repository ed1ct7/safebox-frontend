import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { updateSettings } from '../api/endpoints';
import { errorMessage, isUnauthorized } from '../api/client';
import { settingsQuery } from '../api/queries';
import { useDismiss } from '../hooks/useDismiss';
import { useToast } from './Toasts';

/**
 * Настройки (UF-21): поповер у кнопки, не модалка. Пока одна - «Загружать
 * предпросмотр ссылок»: это запрос к сайту с этого компьютера, поэтому его можно
 * выключить. Настройки не зависят от сейфа; читаются при открытии, PATCH - сразу
 * по переключению.
 */
export function SettingsMenu({ className }: { className: string }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss<HTMLDivElement>(() => setOpen(false), open);
  const qc = useQueryClient();
  const toast = useToast();
  const settings = useQuery({ ...settingsQuery, enabled: open });

  const save = useMutation({
    mutationFn: (linkPreviews: boolean) => updateSettings({ linkPreviews }),
    onSuccess: (data) => qc.setQueryData(settingsQuery.queryKey, data),
    onError: (e) => {
      if (!isUnauthorized(e)) toast(errorMessage(e, 'Не удалось сохранить настройку'), 'error');
    },
  });

  // пока PATCH в пути - показываем выбранное; не удался - вернётся то, что на сервере
  const checked = save.isPending ? save.variables : settings.data?.linkPreviews;

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        className={className}
        aria-label="Настройки"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Настройки"
        onClick={() => setOpen((o) => !o)}
      >
        ⚙
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Настройки"
          className="absolute right-0 top-full z-50 mt-1 w-80 rounded-lg border border-zinc-700 bg-zinc-900 p-4 shadow-2xl"
        >
          {settings.isError ? (
            <p className="text-sm text-red-300" role="alert">
              {settings.error.message}
            </p>
          ) : (
            <>
              <label className="flex cursor-pointer items-center gap-2.5 text-sm text-zinc-200">
                <input
                  type="checkbox"
                  role="switch"
                  className="h-4 w-4 shrink-0 accent-accent"
                  checked={checked ?? false}
                  disabled={checked === undefined}
                  onChange={(e) => save.mutate(e.target.checked)}
                />
                Загружать предпросмотр ссылок
              </label>
              <p className="mt-2 text-xs text-zinc-500">
                Название, описание и картинку сейф берёт со страницы — это запрос к сайту с этого компьютера.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
