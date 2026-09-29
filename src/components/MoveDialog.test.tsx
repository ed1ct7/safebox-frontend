import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Entry, FolderNode } from '../api/types';
import { makeEntry } from '../test/factories';
import { MoveDialog } from './MoveDialog';

const folders: FolderNode[] = [
  { id: 10, parentId: null, name: 'Фото' },
  { id: 11, parentId: 10, name: '2024' },
  { id: 12, parentId: null, name: 'Видео' },
];

function setup(entries: Entry[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(['folders'], { folders });
  const onMove = vi.fn();
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <MoveDialog entries={entries} onMove={onMove} onClose={onClose} />
    </QueryClientProvider>,
  );
  return { onMove, onClose, user: userEvent.setup() };
}

const confirmButton = () => screen.getByRole('button', { name: 'Переместить' });

describe('MoveDialog', () => {
  it('«Переместить» доступно, только когда выбрана цель', async () => {
    const { user, onMove, onClose } = setup([makeEntry({ id: 1, name: 'кот.jpg', parentId: 12 })]);
    expect(screen.getByRole('dialog', { name: 'Переместить «кот.jpg»' })).toBeInTheDocument();
    expect(confirmButton()).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /Фото/ }));
    await user.click(confirmButton());
    expect(onClose).toHaveBeenCalled();
    expect(onMove).toHaveBeenCalledWith(10);
  });

  it('можно выбрать «Все объекты»', async () => {
    const { user, onMove } = setup([makeEntry({ id: 1, parentId: 12 })]);
    await user.click(screen.getByRole('button', { name: /Все объекты/ }));
    await user.click(confirmButton());
    expect(onMove).toHaveBeenCalledWith(null);
  });

  it('вложенные папки раскрываются', async () => {
    const { user, onMove } = setup([makeEntry({ id: 1, parentId: null })]);
    expect(screen.queryByRole('button', { name: /2024/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Развернуть' }));
    await user.click(screen.getByRole('button', { name: /2024/ }));
    await user.click(confirmButton());
    expect(onMove).toHaveBeenCalledWith(11);
  });

  it('сама перемещаемая папка и её подпапки недоступны', async () => {
    const { user } = setup([makeEntry({ id: 10, kind: 'folder', name: 'Фото', parentId: null })]);
    expect(screen.getByRole('button', { name: /Фото/ })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Развернуть' }));
    expect(screen.getByRole('button', { name: /2024/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Видео/ })).toBeEnabled();
  });

  it('место, где записи уже лежат, недоступно', () => {
    setup([makeEntry({ id: 1, parentId: null }), makeEntry({ id: 2, parentId: null })]);
    expect(screen.getByRole('button', { name: /Все объекты/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Фото/ })).toBeEnabled();
  });

  it('несколько записей - счёт в заголовке; Esc и «Отмена» закрывают', async () => {
    const { user, onClose } = setup([makeEntry({ id: 1 }), makeEntry({ id: 2 })]);
    expect(screen.getByRole('dialog', { name: 'Переместить 2 объекта' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });
});
