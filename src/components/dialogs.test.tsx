import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { ConfirmDialog } from './ConfirmDialog';
import { anyModalOpen } from './Modal';
import { useDismiss } from '../hooks/useDismiss';

const request = (onConfirm: () => void) => ({
  title: 'Удалить 2 объекта?',
  message: 'Папки удаляются вместе со всем содержимым.',
  confirmLabel: 'Удалить',
  danger: true,
  onConfirm,
});

describe('ConfirmDialog', () => {
  it('Enter подтверждает (фокус на кнопке действия)', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(<ConfirmDialog request={request(onConfirm)} onClose={onClose} />);
    expect(screen.getByRole('button', { name: 'Удалить' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalled();
  });

  it('Escape отменяет и не долетает до хоткеев окна', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    const windowEscape = vi.fn();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && windowEscape();
    window.addEventListener('keydown', onKey);
    render(<ConfirmDialog request={request(onConfirm)} onClose={onClose} />);
    await user.keyboard('{Escape}');
    window.removeEventListener('keydown', onKey);
    expect(onClose).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(windowEscape).not.toHaveBeenCalled();
  });

  it('пока открыт — глобальные хоткеи молчат', () => {
    const { unmount } = render(<ConfirmDialog request={request(vi.fn())} onClose={vi.fn()} />);
    expect(anyModalOpen()).toBe(true);
    unmount();
    expect(anyModalOpen()).toBe(false);
  });
});

function Dropdown() {
  const [open, setOpen] = useState(false);
  const ref = useDismiss<HTMLDivElement>(() => setOpen(false), open);
  return (
    <div ref={ref}>
      <button type="button" onClick={() => setOpen(true)}>
        меню
      </button>
      {open && <span>пункты</span>}
    </div>
  );
}

describe('useDismiss', () => {
  it('закрытое меню не глотает Escape (раньше Esc не доходил до лайтбокса и выделения)', async () => {
    const user = userEvent.setup();
    const windowEscape = vi.fn();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && windowEscape();
    window.addEventListener('keydown', onKey);
    render(<Dropdown />);

    await user.keyboard('{Escape}');
    expect(windowEscape).toHaveBeenCalledOnce();

    await user.click(screen.getByRole('button', { name: 'меню' }));
    expect(screen.getByText('пункты')).toBeInTheDocument();
    await user.keyboard('{Escape}'); // открытое меню закрывается и забирает Escape себе
    expect(screen.queryByText('пункты')).toBeNull();
    expect(windowEscape).toHaveBeenCalledOnce();
    window.removeEventListener('keydown', onKey);
  });
});
