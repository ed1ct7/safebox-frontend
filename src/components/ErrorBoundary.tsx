import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { PANELS_STORAGE_KEY } from '../hooks/usePanelLayout';

// Последний рубеж: ошибка при отрисовке не оставляет пустое (в окне - чёрное) окно,
// а показывает, что случилось, и даёт перезагрузить. «Сбросить вид» стирает только
// запомненный вид (раскладку панелей, свернутые категории тегов): если интерфейс
// роняет он, после сброса всё откроется как в первый раз. Сессия (sessionStorage)
// и список последних сейфов не трогаются - после перезагрузки вход не нужен.

/** Ключи localStorage с запомненным видом; sbx_tags_filter - от прежней панели фильтра. */
export const VIEW_STORAGE_KEYS = [PANELS_STORAGE_KEY, 'sbx_tags_sidebar', 'sbx_tags_filter'];

export function resetViewStorage(): void {
  for (const key of VIEW_STORAGE_KEYS) {
    try {
      localStorage.removeItem(key);
    } catch {
      // хранилище недоступно - сбрасывать нечего
    }
  }
}

const reloadPage = () => window.location.reload();

export class ErrorBoundary extends Component<
  { children: ReactNode; /** тесты подменяют перезагрузку */ onReload?: () => void },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('SafeBox: интерфейс упал', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (error === null) return this.props.children;
    const reload = this.props.onReload ?? reloadPage;
    return (
      <div role="alert" className="flex min-h-screen flex-col items-center justify-center gap-4 bg-zinc-950 p-6 text-center">
        <p className="text-lg text-zinc-100">Интерфейс SafeBox упал</p>
        <p className="max-w-xl break-words text-xs text-zinc-500">{error.message}</p>
        <div className="flex gap-3">
          <button
            type="button"
            className="rounded-lg bg-accent px-4 py-1.5 text-sm text-white hover:bg-accent-hover"
            onClick={reload}
          >
            Перезагрузить
          </button>
          <button
            type="button"
            className="rounded-lg border border-zinc-700 px-4 py-1.5 text-sm text-zinc-200 hover:border-zinc-500"
            title="Раскладка панелей и свернутые категории тегов вернутся к исходным; сейф и сессия не затрагиваются"
            onClick={() => {
              resetViewStorage();
              reload();
            }}
          >
            Сбросить вид и перезагрузить
          </button>
        </div>
      </div>
    );
  }
}
