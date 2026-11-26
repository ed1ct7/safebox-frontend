import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Entry } from '../api/types';
import type { Places } from '../lib/places';
import { makeEntry } from '../test/factories';
import { MovePalette } from './MovePalette';

const folders = [
  { id: 1, parentId: null, name: 'Мемы' },
  { id: 2, parentId: 1, name: 'Животные' },
  { id: 3, parentId: null, name: 'Разное' },
  { id: 4, parentId: null, name: 'Видео' },
];

function show({
  entries = [makeEntry({ id: 50, name: 'кот.jpg', parentId: 3 })],
  places = [],
  recent = [],
}: { entries?: Entry[]; places?: Places; recent?: number[] } = {}) {
  const qc = new QueryClient();
  qc.setQueryData(['folders'], { folders });
  const props = {
    onTogglePlace: vi.fn(),
    onMove: vi.fn(),
    onCreate: vi.fn(),
    onClose: vi.fn(),
  };
  render(
    <QueryClientProvider client={qc}>
      <MovePalette entries={entries} places={places} recent={recent} {...props} />
    </QueryClientProvider>,
  );
  return { ...props, user: userEvent.setup() };
}

const options = () => screen.getAllByRole('option').map((o) => o.textContent?.replace(/[☆★]/g, '').trim());

describe('MovePalette', () => {
  it('без запроса: «Места» с цифрами, недавние, затем все папки; где лежит - недоступно', () => {
    show({ places: [4, null, 2], recent: [3, 2, 1] });
    const list = screen.getByRole('listbox');
    expect(within(list).getByText('Места')).toBeInTheDocument();
    expect(within(list).getByText('Недавние')).toBeInTheDocument();
    expect(options().slice(0, 4)).toEqual(['1📁 Видео', '3📁 Мемы / Животные', '📁 Разноездесь', '📁 Мемы']);
    expect(screen.getAllByRole('option', { name: /Разное/ })[0]).toHaveAttribute('aria-disabled', 'true');
  });

  it('поиск по пути, Enter - первая доступная', async () => {
    const { user, onMove } = show();
    await user.keyboard('мем жив');
    expect(options()).toEqual(['📁 Мемы / Животные', '＋ Создать папку «мем жив» и переместить']);
    await user.keyboard('{Enter}');
    expect(onMove).toHaveBeenCalledWith(2);
  });

  it('стрелки пропускают недоступное; клик выбирает', async () => {
    const { user, onMove } = show();
    await user.keyboard('е');
    // «Разное» (там лежит) недоступна, активна первая доступная
    const active = () => screen.getAllByRole('option').find((o) => o.getAttribute('aria-selected') === 'true');
    const first = active()?.textContent;
    expect(first).not.toMatch(/Разное/);
    await user.keyboard('{ArrowDown}');
    expect(active()?.textContent).not.toMatch(/Разное/);
    await user.click(screen.getByRole('option', { name: /Мемы \/ Животные/ }));
    expect(onMove).toHaveBeenCalledWith(2);
  });

  it('«Все объекты» находятся поиском', async () => {
    const { user, onMove } = show();
    await user.keyboard('все объ{Enter}');
    expect(onMove).toHaveBeenCalledWith(null);
  });

  it('пути нет - «Создать папку … и переместить» с путём от корня', async () => {
    const { user, onCreate, onMove } = show();
    await user.keyboard('Мемы / Коты');
    await user.click(screen.getByRole('option', { name: /Создать папку «Мемы \/ Коты»/ }));
    expect(onCreate).toHaveBeenCalledWith('Мемы/Коты');
    expect(onMove).not.toHaveBeenCalled();
  });

  it('точный путь уже есть - строки «Создать» нет', async () => {
    const { user } = show();
    await user.keyboard('мемы/животные');
    expect(screen.queryByRole('option', { name: /Создать/ })).toBeNull();
  });

  it('☆ - в «Места», не перемещая; Esc - отказ', async () => {
    const { user, onTogglePlace, onMove, onClose } = show();
    await user.keyboard('вид');
    await user.click(screen.getByRole('button', { name: 'Добавить в «Места»' }));
    expect(onTogglePlace).toHaveBeenCalledWith(4);
    expect(onMove).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('перемещаемую папку нельзя в саму себя и внутрь', async () => {
    const { user } = show({ entries: [makeEntry({ id: 1, kind: 'folder', name: 'Мемы', parentId: null })] });
    await user.keyboard('мем');
    for (const o of screen.getAllByRole('option', { name: /Мемы/ })) {
      if (!/Создать/.test(o.textContent ?? '')) expect(o).toHaveAttribute('aria-disabled', 'true');
    }
  });
});
