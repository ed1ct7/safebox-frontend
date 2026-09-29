import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ToastProvider, useToast } from './Toasts';
import type { ToastAction } from './Toasts';

function Pusher({ text, action }: { text: string; action?: ToastAction }) {
  const toast = useToast();
  return (
    <button type="button" onClick={() => toast(text, 'info', action)}>
      показать
    </button>
  );
}

function setup(text: string, action?: ToastAction) {
  render(
    <ToastProvider>
      <Pusher text={text} action={action} />
    </ToastProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'показать' }));
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('Toasts', () => {
  it('тост сам исчезает', () => {
    setup('Готово');
    expect(screen.getByText('Готово')).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(4600));
    expect(screen.queryByText('Готово')).toBeNull();
  });

  it('клик по тосту его закрывает', () => {
    setup('Готово');
    fireEvent.click(screen.getByText('Готово'));
    expect(screen.queryByText('Готово')).toBeNull();
  });

  it('кнопка действия: выполняет его и закрывает тост', () => {
    const onClick = vi.fn();
    setup('Уже есть', { label: 'Показать', onClick });
    fireEvent.click(screen.getByRole('button', { name: 'Показать' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Уже есть')).toBeNull();
  });

  it('тост с кнопкой живёт дольше обычного, чтобы успеть нажать', () => {
    setup('Уже есть', { label: 'Показать', onClick: vi.fn() });
    act(() => void vi.advanceTimersByTime(6000));
    expect(screen.getByRole('button', { name: 'Показать' })).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(2600));
    expect(screen.queryByText('Уже есть')).toBeNull();
  });
});
