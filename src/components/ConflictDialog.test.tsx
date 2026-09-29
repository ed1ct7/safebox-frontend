import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConflictDialog } from './ConflictDialog';
import type { ConflictItem, ConflictKind } from '../lib/conflicts';

const items: ConflictItem[] = [
  {
    key: 'a.txt',
    name: 'a.txt',
    incoming: { folder: false, size: 2048, modifiedAt: new Date(2025, 0, 2, 9, 5).getTime() },
    existing: { folder: false, size: 1024, modifiedAt: new Date(2024, 11, 31, 23, 59).getTime() },
  },
  {
    key: 'P/b.jpg',
    name: 'P/b.jpg',
    incoming: { folder: false, size: 10, modifiedAt: null },
    existing: { folder: true, size: null, modifiedAt: 0 },
  },
];

function setup(kind: ConflictKind = 'import') {
  const onDone = vi.fn();
  render(<ConflictDialog request={{ kind, items }} onDone={onDone} />);
  return { onDone, user: userEvent.setup() };
}

describe('ConflictDialog', () => {
  it('спрашивает, сколько совпало, и предлагает три пути', () => {
    setup();
    expect(screen.getByRole('dialog', { name: 'В папке уже есть 2 файла с такими же именами' })).toBeInTheDocument();
    for (const name of ['Заменить', 'Пропустить', 'Решить для каждого файла']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('«Заменить» и «Пропустить» - одно решение на все файлы', async () => {
    const first = setup();
    await first.user.click(screen.getByRole('button', { name: 'Заменить' }));
    expect([...(first.onDone.mock.calls[0]?.[0] as Map<string, string>)]).toEqual([
      ['a.txt', 'replace'],
      ['P/b.jpg', 'replace'],
    ]);
  });

  it('«Пропустить» - фокус по умолчанию: Enter ничего не перезаписывает', async () => {
    const { onDone, user } = setup();
    expect(screen.getByRole('button', { name: 'Пропустить' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect((onDone.mock.calls[0]?.[0] as Map<string, string>).get('a.txt')).toBe('skip');
  });

  it('закрытие диалога (Esc, «Отмена») отменяет всю операцию', async () => {
    const first = setup();
    await first.user.keyboard('{Escape}');
    expect(first.onDone).toHaveBeenCalledWith(null);
  });

  it('«Отмена» - тоже отмена', async () => {
    const { onDone, user } = setup();
    await user.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(onDone).toHaveBeenCalledWith(null);
  });

  describe('решение для каждого файла', () => {
    const openEach = async () => {
      const s = setup();
      await s.user.click(screen.getByRole('button', { name: 'Решить для каждого файла' }));
      return s;
    };

    it('у каждого файла две галочки с размером и датой обеих сторон', async () => {
      await openEach();
      const row = screen.getByText('a.txt').closest('li') as HTMLElement;
      const boxes = within(row).getAllByRole('checkbox');
      expect(boxes).toHaveLength(2);
      expect(within(row).getByText('Из импорта')).toBeInTheDocument();
      expect(within(row).getByText('В сейфе')).toBeInTheDocument();
      expect(within(row).getByText('2.0 КБ · 02.01.2025 09:05')).toBeInTheDocument();
      expect(within(row).getByText('1.0 КБ · 31.12.2024 23:59')).toBeInTheDocument();
      const other = screen.getByText('P/b.jpg').closest('li') as HTMLElement;
      expect(within(other).getByText('10 Б · —')).toBeInTheDocument(); // дата файла неизвестна
      expect(within(other).getByText(/^Папка ·/)).toBeInTheDocument();
    });

    it('«Продолжить» недоступно, пока у какого-то файла нет ни одной галочки', async () => {
      const { user } = await openEach();
      const cont = screen.getByRole('button', { name: 'Продолжить' });
      expect(cont).toBeDisabled();
      expect(screen.getByText('Не выбрано: 2')).toBeInTheDocument();
      const [aIncoming] = within(screen.getByText('a.txt').closest('li') as HTMLElement).getAllByRole('checkbox');
      await user.click(aIncoming as HTMLElement);
      expect(cont).toBeDisabled();
      expect(screen.getByText('Не выбрано: 1')).toBeInTheDocument();
    });

    it('только «Из импорта» - заменить, только «В сейфе» - пропустить, обе - оставить оба', async () => {
      const { onDone, user } = await openEach();
      const [aIn] = within(screen.getByText('a.txt').closest('li') as HTMLElement).getAllByRole('checkbox');
      const [bIn, bSafe] = within(screen.getByText('P/b.jpg').closest('li') as HTMLElement).getAllByRole('checkbox');
      await user.click(aIn as HTMLElement); // только импорт
      await user.click(bIn as HTMLElement);
      await user.click(bSafe as HTMLElement); // обе
      await user.click(screen.getByRole('button', { name: 'Продолжить' }));
      expect([...(onDone.mock.calls[0]?.[0] as Map<string, string>)]).toEqual([
        ['a.txt', 'replace'],
        ['P/b.jpg', 'keepBoth'],
      ]);
    });

    it('«Все: В сейфе» отмечает колонку целиком - всё пропустить', async () => {
      const { onDone, user } = await openEach();
      await user.click(screen.getByRole('checkbox', { name: 'Отметить все: В сейфе' }));
      await user.click(screen.getByRole('button', { name: 'Продолжить' }));
      expect([...(onDone.mock.calls[0]?.[0] as Map<string, string>)]).toEqual([
        ['a.txt', 'skip'],
        ['P/b.jpg', 'skip'],
      ]);
    });

    it('Esc в режиме списка отменяет весь импорт', async () => {
      const { onDone, user } = await openEach();
      await user.keyboard('{Escape}');
      expect(onDone).toHaveBeenCalledWith(null);
    });
  });

  it('перемещение: те же три варианта, стороны - «Из перемещаемого» и «В папке»', async () => {
    const { user } = setup('move');
    expect(screen.getByRole('dialog', { name: 'В папке уже есть 2 записи с такими же именами' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Решить для каждого файла' }));
    expect(screen.getAllByText('Из перемещаемого')).toHaveLength(2);
    expect(screen.getAllByText('В папке')).toHaveLength(2);
    expect(screen.queryByText('Из импорта')).toBeNull();
  });
});
