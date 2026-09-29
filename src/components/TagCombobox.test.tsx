import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiRequestError } from '../api/client';
import { installFakeServer } from '../test/fakeServer';
import { makeCategories, makeWrapper } from '../test/tags';
import { TagCombobox } from './TagCombobox';
import type { TagComboboxProps } from './TagCombobox';

beforeEach(() => {
  installFakeServer({ 'GET /api/v1/tags': () => ({ json: { categories: makeCategories() } }) });
});
afterEach(() => vi.unstubAllGlobals());

async function setup(extra: Partial<TagComboboxProps> = {}) {
  const onPick = vi.fn(() => Promise.resolve());
  const onCreate = vi.fn(() => Promise.resolve());
  const view = render(
    <TagCombobox label="Тег" allowCreate onPick={onPick} onCreate={onCreate} {...extra} />,
    { wrapper: makeWrapper().Wrapper },
  );
  const user = userEvent.setup();
  const box = screen.getByRole('combobox', { name: 'Тег' });
  // каталог грузится с сервера: ждём, пока подсказки его увидят
  await user.type(box, 'ru');
  await screen.findByRole('option', { name: /language: ru/ });
  await user.clear(box);
  return { onPick, onCreate, user, box, ...view };
}

describe('TagCombobox: выбор существующего тега', () => {
  it('стрелки и Enter: выбранный вариант уходит в onPick, поле очищается', async () => {
    const { user, box, onPick } = await setup();
    await user.type(box, 'eris');
    const option = await screen.findByRole('option', { name: /character: eris greyrat/ });
    expect(option).toHaveAttribute('aria-selected', 'false'); // пока не выбран
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('option', { name: /character: eris greyrat/ })).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{Enter}');
    expect(onPick).toHaveBeenCalledOnce();
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 1, name: 'eris greyrat', category: 'character' }));
    expect(box).toHaveValue('');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('ищет по категории и тегу, без учёта регистра', async () => {
    const { user, box } = await setup();
    await user.type(box, 'CHARACTER:roxy');
    expect(await screen.findByRole('option', { name: /character: roxy migurdia/ })).toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(2); // и «Создать тег roxy в категории character»
    await user.clear(box);
    await user.type(box, 'char:roxy'); // «char» - не категория: тег находится, но создаётся только новая категория
    expect(await screen.findByRole('option', { name: /character: roxy migurdia/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Создать категорию char и тег roxy' })).toBeInTheDocument();
  });

  it('клик по варианту тоже выбирает', async () => {
    const { user, box, onPick } = await setup();
    await user.type(box, 'roxy');
    await user.click(await screen.findByRole('option', { name: /roxy migurdia/ }));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }));
  });

  it('ArrowUp с начала переходит к последнему варианту, ArrowDown обходит по кругу', async () => {
    const { user, box } = await setup();
    await user.type(box, 'character:');
    await screen.findAllByRole('option');
    await user.keyboard('{ArrowUp}');
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowDown}');
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('Enter без выбранной строки берёт тег, введённый целиком', async () => {
    const { user, box, onPick } = await setup();
    await user.type(box, 'Character: Eris Greyrat{Enter}');
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
  });

  it('в фильтре Enter по неполному вводу берёт первый вариант', async () => {
    const { user, box, onPick } = await setup({ allowCreate: false });
    await user.type(box, 'eris');
    await screen.findByRole('option', { name: /character: eris greyrat/ });
    await user.keyboard('{Enter}');
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
  });

  it('Tab подставляет вариант в поле, не выбирая его; повторный Tab уводит фокус', async () => {
    const { user, box, onPick } = await setup();
    await user.type(box, 'eris');
    await screen.findByRole('option', { name: /eris greyrat/ });
    await user.tab();
    expect(box).toHaveValue('character:eris greyrat');
    expect(box).toHaveFocus();
    expect(onPick).not.toHaveBeenCalled();
    await user.tab();
    expect(box).not.toHaveFocus();
    expect(onPick).not.toHaveBeenCalled();
  });

  it('Tab в пустом поле - обычный переход фокуса', async () => {
    const { user, box } = await setup();
    await user.click(box);
    await user.tab();
    expect(box).not.toHaveFocus();
  });

  it('исключённые теги не предлагаются, введённый целиком - «уже добавлен»', async () => {
    const { user, box, onPick } = await setup({ exclude: new Set([1]) });
    await user.type(box, 'character:eris greyrat');
    expect(await screen.findByText('Этот тег уже добавлен')).toBeInTheDocument();
    expect(screen.queryByRole('option')).toBeNull();
    await user.keyboard('{Enter}');
    expect(onPick).not.toHaveBeenCalled();
  });
});

describe('TagCombobox: подсказки', () => {
  it('без «:» и без совпадений - «укажите категорию»', async () => {
    const { user, box } = await setup();
    await user.type(box, 'zzz');
    expect(await screen.findByText('Укажите категорию: категория:тег')).toBeInTheDocument();
    expect(screen.queryByRole('option')).toBeNull();
    await user.keyboard('{Enter}'); // создавать нечего
    expect(box).toHaveValue('zzz');
  });

  it('в фильтре (без создания) - «такого тега нет», варианта создания нет', async () => {
    const { user, box } = await setup({ allowCreate: false });
    await user.type(box, 'место:Рим');
    expect(await screen.findByText('Такого тега нет')).toBeInTheDocument();
    expect(screen.queryByRole('option')).toBeNull();
  });

  it('«:» в имени тега - сообщение, создавать нельзя', async () => {
    const { user, box, onCreate } = await setup();
    await user.type(box, 'character:a:b');
    expect(await screen.findByText('Символ «:» в имени тега запрещён')).toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('Символ «:» в имени тега запрещён');
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('пустая категория - сообщение', async () => {
    const { user, box } = await setup();
    await user.type(box, ':тег{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('Укажите категорию');
  });
});

describe('TagCombobox: создание', () => {
  it('нет тега в существующей категории - «Создать тег Y в категории X», без подтверждения', async () => {
    const { user, box, onCreate } = await setup();
    await user.type(box, 'CHARACTER:sylphy');
    const option = await screen.findByRole('option', { name: 'Создать тег sylphy в категории character' });
    expect(option).toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(onCreate).toHaveBeenCalledWith({ category: 'character', name: 'sylphy', newCategory: false });
    expect(screen.queryByRole('group', { name: /Подтверждение/ })).toBeNull();
    expect(box).toHaveValue('');
  });

  it('нет и категории - «Создать категорию X и тег Y», сначала подтверждение в самом поле', async () => {
    const { user, box, onCreate } = await setup();
    await user.type(box, 'место:Рим');
    expect(await screen.findByRole('option', { name: 'Создать категорию место и тег Рим' })).toBeInTheDocument();
    await user.keyboard('{Enter}');
    const confirm = await screen.findByRole('group', { name: /Подтверждение/ });
    expect(confirm).toHaveTextContent('Создать категорию место и тег Рим?');
    expect(screen.queryByRole('dialog')).toBeNull(); // не модалка
    expect(onCreate).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Создать' }));
    expect(onCreate).toHaveBeenCalledWith({ category: 'место', name: 'Рим', newCategory: true });
    expect(box).toHaveValue('');
    expect(screen.queryByRole('group', { name: /Подтверждение/ })).toBeNull();
    expect(box).toHaveFocus(); // фокус вернулся в поле - можно вводить следующий тег
  });

  it('«Отмена» и Esc в подтверждении ничего не создают и возвращают в поле', async () => {
    const { user, box, onCreate } = await setup();
    await user.type(box, 'место:Рим{Enter}');
    await user.click(await screen.findByRole('button', { name: 'Отмена' }));
    expect(screen.queryByRole('group', { name: /Подтверждение/ })).toBeNull();
    expect(box).toHaveFocus();
    expect(box).toHaveValue('место:Рим');

    await user.keyboard('{Enter}');
    await screen.findByRole('group', { name: /Подтверждение/ });
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('group', { name: /Подтверждение/ })).toBeNull();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('правка текста снимает подтверждение', async () => {
    const { user, box } = await setup();
    await user.type(box, 'место:Рим{Enter}');
    await screen.findByRole('group', { name: /Подтверждение/ });
    await user.type(box, 'а');
    expect(screen.queryByRole('group', { name: /Подтверждение/ })).toBeNull();
  });

  it('422 сервера - под полем, текст остаётся, подтверждение закрыто', async () => {
    const onCreate = vi.fn(() =>
      Promise.reject(new ApiRequestError(422, 'invalid_argument', 'Имя тега слишком длинное')),
    );
    const { user, box } = await setup({ onCreate });
    await user.type(box, 'место:Рим{Enter}');
    await user.click(await screen.findByRole('button', { name: 'Создать' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Имя тега слишком длинное');
    expect(box).toHaveValue('место:Рим');
    expect(screen.queryByRole('group', { name: /Подтверждение/ })).toBeNull();
    await user.type(box, 'а'); // правка стирает ошибку
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('отказ при выборе существующего тега тоже показывается под полем', async () => {
    const onPick = vi.fn(() => Promise.reject(new ApiRequestError(422, 'invalid_argument', 'Слишком много тегов')));
    const { user, box } = await setup({ onPick });
    await user.type(box, 'ru{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('Слишком много тегов');
    expect(box).toHaveValue('ru');
  });
});

describe('TagCombobox: Esc', () => {
  it('сначала закрывает список, потом очищает поле, дальше не перехватывается', async () => {
    const { user, box } = await setup();
    const outer = vi.fn();
    document.addEventListener('keydown', outer);
    await user.type(box, 'eris');
    await screen.findByRole('listbox');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(box).toHaveValue('eris');
    await user.keyboard('{Escape}');
    expect(box).toHaveValue('');
    expect(outer.mock.calls.filter(([e]) => (e as KeyboardEvent).key === 'Escape')).toHaveLength(0);
    await user.keyboard('{Escape}'); // поле пусто - Esc уходит наружу (закрыть поповер)
    expect(outer.mock.calls.filter(([e]) => (e as KeyboardEvent).key === 'Escape')).toHaveLength(1);
    document.removeEventListener('keydown', outer);
  });
});
