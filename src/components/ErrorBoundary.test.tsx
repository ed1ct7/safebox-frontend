import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary';

function Boom(): never {
  throw new Error('Maximum update depth exceeded');
}

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('ErrorBoundary', () => {
  it('без ошибки - просто содержимое', () => {
    render(
      <ErrorBoundary>
        <p>сейф</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText('сейф')).toBeInTheDocument();
  });

  it('упавшая отрисовка - сообщение и перезагрузка вместо пустого окна', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const reload = vi.fn();
    render(
      <ErrorBoundary onReload={reload}>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Maximum update depth exceeded');
    fireEvent.click(screen.getByRole('button', { name: 'Перезагрузить' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('«Сбросить вид» стирает только запомненный вид, не последние сейфы', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    localStorage.setItem('sbx_panels', '{"layout":{}}');
    localStorage.setItem('sbx_tags_sidebar', '{"collapsed":[],"full":[12]}');
    localStorage.setItem('sbx_tags_filter', '{"collapsed":[],"full":[12]}');
    localStorage.setItem('sbx_recent_safes', '["archive"]');
    const reload = vi.fn();
    render(
      <ErrorBoundary onReload={reload}>
        <Boom />
      </ErrorBoundary>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить вид и перезагрузить' }));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('sbx_panels')).toBeNull();
    expect(localStorage.getItem('sbx_tags_sidebar')).toBeNull();
    expect(localStorage.getItem('sbx_tags_filter')).toBeNull();
    expect(localStorage.getItem('sbx_recent_safes')).toBe('["archive"]');
  });
});
