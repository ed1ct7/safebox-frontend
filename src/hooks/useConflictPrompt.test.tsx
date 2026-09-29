import { describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ConflictItem, ConflictRequest } from '../lib/conflicts';
import type { Resolutions } from '../lib/importPlan';
import { useConflictPrompt } from './useConflictPrompt';
import type { AskConflicts } from './useConflictPrompt';

const request = (name: string): ConflictRequest => {
  const item: ConflictItem = {
    key: name,
    name,
    incoming: { folder: false, size: 1, modifiedAt: 1 },
    existing: { folder: false, size: 2, modifiedAt: 2 },
  };
  return { kind: 'import', items: [item] };
};

function Host({ onAsk }: { onAsk: (ask: AskConflicts) => void }) {
  const { ask, element } = useConflictPrompt();
  onAsk(ask);
  return <>{element}</>;
}

function setup() {
  let ask: AskConflicts = () => Promise.resolve(null);
  const view = render(<Host onAsk={(a) => (ask = a)} />);
  return { ask: (r: ConflictRequest) => ask(r), ...view, user: userEvent.setup() };
}

describe('useConflictPrompt', () => {
  it('ответ пользователя приходит как результат обещания, диалог исчезает', async () => {
    const { ask, user } = setup();
    let answer: Resolutions | null | undefined;
    act(() => {
      void ask(request('a.txt')).then((r) => (answer = r));
    });
    await user.click(await screen.findByRole('button', { name: 'Заменить' }));
    expect([...(answer ?? [])]).toEqual([['a.txt', 'replace']]);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('отмена - null', async () => {
    const { ask, user } = setup();
    let answer: Resolutions | null | undefined;
    act(() => {
      void ask(request('a.txt')).then((r) => (answer = r));
    });
    await user.keyboard('{Escape}');
    expect(answer).toBeNull();
  });

  it('одновременные вопросы показываются по одному, по очереди', async () => {
    const { ask, user } = setup();
    const answers: string[] = [];
    act(() => {
      void ask(request('первый.txt')).then((r) => answers.push(`1:${[...(r ?? [])][0]?.[1]}`));
      void ask(request('второй.txt')).then((r) => answers.push(`2:${[...(r ?? [])][0]?.[1]}`));
    });
    expect(await screen.findByRole('dialog', { name: /1 файл/ })).toBeInTheDocument();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Пропустить' }));
    await user.click(await screen.findByRole('button', { name: 'Заменить' }));
    expect(answers).toEqual(['1:skip', '2:replace']);
  });

  it('размонтирование (блокировка сейфа) отменяет ожидающих', async () => {
    const { ask, unmount } = setup();
    let answer: Resolutions | null | undefined;
    act(() => {
      void ask(request('a.txt')).then((r) => (answer = r));
    });
    await screen.findByRole('dialog');
    unmount();
    await Promise.resolve();
    expect(answer).toBeNull();
  });
});
