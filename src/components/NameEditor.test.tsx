import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NameEditor } from './NameEditor';

describe('NameEditor (инлайн-переименование)', () => {
  it('выделяет имя без расширения, как проводник по F2', () => {
    const { getByRole } = render(
      <NameEditor initial="Фото.jpg" onCommit={() => undefined} onCancel={() => undefined} />,
    );
    const input = getByRole('textbox') as HTMLInputElement;
    expect(input).toHaveFocus();
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe('Фото'.length);
  });

  it('Enter фиксирует имя', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    const { getByRole } = render(
      <NameEditor initial="Старое.txt" onCommit={onCommit} onCancel={() => undefined} />,
    );
    const input = getByRole('textbox');
    await user.clear(input);
    await user.type(input, 'Новое.txt{Enter}');
    expect(onCommit).toHaveBeenCalledWith('Новое.txt');
  });

  it('Escape отменяет без коммита', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    const { getByRole } = render(
      <NameEditor initial="Имя" onCommit={onCommit} onCancel={onCancel} />,
    );
    await user.type(getByRole('textbox'), 'хвост{Escape}');
    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('не фиксирует имя с запрещёнными символами', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    const { getByRole } = render(
      <NameEditor initial="Имя" onCommit={onCommit} onCancel={() => undefined} />,
    );
    const input = getByRole('textbox');
    await user.clear(input);
    await user.type(input, 'a/b{Enter}');
    expect(onCommit).not.toHaveBeenCalled();
  });
});
