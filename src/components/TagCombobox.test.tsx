import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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
  it('голое имя без совпадений - вариант «Создать тег …» (без разговоров о категории)', async () => {
    const { user, box } = await setup();
    await user.type(box, 'zzz');
    expect(await screen.findByRole('option', { name: 'Создать тег zzz…' })).toBeInTheDocument();
    expect(screen.queryByText(/Укажите категорию/)).toBeNull();
    await user.keyboard('{Enter}'); // открывает панель выбора категории - отдельно ниже
    expect(screen.getByRole('group', { name: 'Категория нового тега' })).toBeInTheDocument();
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
  it('нет тега в существующей категории - «Создать тег Y в категории X», без панели', async () => {
    const { user, box, onCreate } = await setup();
    await user.type(box, 'CHARACTER:sylphy');
    const option = await screen.findByRole('option', { name: 'Создать тег sylphy в категории character' });
    expect(option).toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(onCreate).toHaveBeenCalledWith({ category: 'character', name: 'sylphy', newCategory: false });
    expect(screen.queryByRole('group', { name: /Категория нового тега/ })).toBeNull();
    expect(box).toHaveValue('');
  });

  it('голое имя: панель с категориями, клик по чипу - тег в существующей категории', async () => {
    const { user, box, onCreate } = await setup();
    await user.type(box, 'zzz');
    await user.keyboard('{Enter}');
    const panel = await screen.findByRole('group', { name: 'Категория нового тега' });
    expect(within(panel).getByText(/Новый тег/)).toBeInTheDocument();
    expect(within(panel).getByText('zzz')).toBeInTheDocument();
    expect(onCreate).not.toHaveBeenCalled();
    await user.click(within(panel).getByRole('button', { name: 'character' }));
    await user.click(within(panel).getByRole('button', { name: 'Создать тег «zzz»' }));
    expect(onCreate).toHaveBeenCalledWith({ category: 'character', name: 'zzz', newCategory: false });
    expect(box).toHaveValue('');
    expect(screen.queryByRole('group', { name: /Категория нового тега/ })).toBeNull();
    expect(box).toHaveFocus();
  });

  it('в панели можно вписать новую категорию (Enter в её поле)', async () => {
    const { user, onCreate } = await setup();
    await user.type(screen.getByRole('combobox', { name: 'Тег' }), 'zzz{Enter}');
    const panel = await screen.findByRole('group', { name: 'Категория нового тега' });
    await user.type(within(panel).getByRole('textbox', { name: 'Новая категория' }), 'место{Enter}');
    expect(onCreate).toHaveBeenCalledWith({ category: 'место', name: 'zzz', newCategory: true });
  });

  it('«Создать» без выбранной категории ничего не делает', async () => {
    const { user, onCreate } = await setup();
    await user.type(screen.getByRole('combobox', { name: 'Тег' }), 'zzz{Enter}');
    const panel = await screen.findByRole('group', { name: 'Категория нового тега' });
    const button = within(panel).getByRole('button', { name: 'Создать тег «zzz»' });
    expect(button).toBeDisabled();
    await user.click(within(panel).getByRole('button', { name: 'character' }));
    expect(button).toBeEnabled();
    await user.click(button);
    expect(onCreate).toHaveBeenCalledWith({ category: 'character', name: 'zzz', newCategory: false });
  });

  it('плохое имя новой категории - ошибка в панели', async () => {
    const { user, onCreate } = await setup();
    await user.type(screen.getByRole('combobox', { name: 'Тег' }), 'zzz{Enter}');
    const panel = await screen.findByRole('group', { name: 'Категория нового тега' });
    await user.type(within(panel).getByRole('textbox', { name: 'Новая категория' }), 'ме:сто{Enter}');
    expect(await within(panel).findByRole('alert')).toHaveTextContent('категории');
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('«место:Рим»: панель открыта с вписанной новой категорией, Создать создаёт', async () => {
    const { user, box, onCreate } = await setup();
    await user.type(box, 'место:Рим');
    expect(await screen.findByRole('option', { name: 'Создать категорию место и тег Рим' })).toBeInTheDocument();
    await user.keyboard('{Enter}');
    const panel = await screen.findByRole('group', { name: 'Категория нового тега' });
    expect(within(panel).getByRole('textbox', { name: 'Новая категория' })).toHaveValue('место');
    expect(screen.queryByRole('dialog')).toBeNull(); // не модалка
    expect(onCreate).not.toHaveBeenCalled();
    await user.click(within(panel).getByRole('button', { name: 'Создать тег «Рим»' }));
    expect(onCreate).toHaveBeenCalledWith({ category: 'место', name: 'Рим', newCategory: true });
    expect(box).toHaveValue('');
    expect(screen.queryByRole('group', { name: /Категория нового тега/ })).toBeNull();
    expect(box).toHaveFocus(); // фокус вернулся в поле - можно вводить следующий тег
  });

  it('«Отмена» и Esc в панели ничего не создают и возвращают в поле', async () => {
    const { user, box, onCreate } = await setup();
    await user.type(box, 'место:Рим{Enter}');
    const panel = await screen.findByRole('group', { name: 'Категория нового тега' });
    await user.click(within(panel).getByRole('button', { name: 'Отмена' }));
    expect(screen.queryByRole('group', { name: /Категория нового тега/ })).toBeNull();
    expect(box).toHaveFocus();
    expect(box).toHaveValue('место:Рим');

    await user.keyboard('{Enter}');
    await screen.findByRole('group', { name: 'Категория нового тега' });
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('group', { name: /Категория нового тега/ })).toBeNull();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('правка текста снимает панель', async () => {
    const { user, box } = await setup();
    await user.type(box, 'zzz{Enter}');
    await screen.findByRole('group', { name: 'Категория нового тега' });
    await user.type(box, 'а');
    expect(screen.queryByRole('group', { name: /Категория нового тега/ })).toBeNull();
  });

  it('422 сервера - под полем, текст остаётся, панель закрыта', async () => {
    const onCreate = vi.fn(() =>
      Promise.reject(new ApiRequestError(422, 'invalid_argument', 'Имя тега слишком длинное')),
    );
    const { user, box } = await setup({ onCreate });
    await user.type(box, 'zzz{Enter}');
    const panel = await screen.findByRole('group', { name: 'Категория нового тега' });
    await user.click(within(panel).getByRole('button', { name: 'character' }));
    await user.click(within(panel).getByRole('button', { name: 'Создать тег «zzz»' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Имя тега слишком длинное');
    expect(box).toHaveValue('zzz');
    expect(screen.queryByRole('group', { name: /Категория нового тега/ })).toBeNull();
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

describe('TagCombobox: подсказки видны сразу', () => {
  function mountBox(extra: Partial<TagComboboxProps> = {}) {
    const onPick = vi.fn(() => Promise.resolve());
    render(<TagCombobox label="Тег" allowCreate onPick={onPick} {...extra} />, {
      wrapper: makeWrapper().Wrapper,
    });
    return { onPick, user: userEvent.setup(), box: screen.getByRole('combobox', { name: 'Тег' }) };
  }

  it('фокус в пустом поле открывает весь каталог: выбрать можно без ввода', async () => {
    const { onPick, user, box } = mountBox();
    await user.click(box);
    const options = await screen.findAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual([
      'character: eris greyrat3',
      'character: roxy migurdia1',
      'language: ru4',
    ]);
    await user.click(screen.getByRole('option', { name: /language: ru/ }));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 5 }));
    expect(box).toHaveValue('');
  });

  it('кнопка ▾ открывает и закрывает список, фокус остаётся в поле', async () => {
    const { user, box } = mountBox();
    const toggle = screen.getByRole('button', { name: 'Показать существующие теги' });
    await user.click(toggle);
    expect(await screen.findAllByRole('option')).toHaveLength(3);
    expect(box).toHaveFocus();
    await user.click(toggle);
    expect(screen.queryByRole('option')).toBeNull();
  });

  it('под открытым каталогом - подсказка, как создать новый тег', async () => {
    const { user, box } = mountBox();
    await user.click(box);
    expect(await screen.findByText('Новый тег — введите имя')).toBeInTheDocument();
  });

  it('в режиме фильтра подсказки про создание нет', async () => {
    const { user, box } = mountBox({ allowCreate: false });
    await user.click(box);
    await screen.findAllByRole('option');
    expect(screen.queryByText('Новый тег — введите имя')).toBeNull();
  });
});

// Язык тегов: варианты подписаны на нём, а искать можно по любому из двух имён.
describe('TagCombobox: язык тегов', () => {
  const bilingual = () =>
    makeCategories().map((c) =>
      c.id === 10
        ? { ...c, nameEn: 'Characters', tags: c.tags.map((t) => (t.id === 1 ? { ...t, nameEn: 'Erisu' } : t)) }
        : c,
    );
  const serve = (tagLanguage: 'ru' | 'en') =>
    installFakeServer({
      'GET /api/v1/tags': () => ({ json: { categories: bilingual() } }),
      'GET /api/v1/settings': () => ({ json: { linkPreviews: true, tagLanguage } }),
    });

  it('en: подпись «Characters: Erisu»; найти можно и по основному имени, Tab подставляет подпись', async () => {
    serve('en');
    const { user, box, onPick } = await setup();
    await user.type(box, 'eris greyrat'); // основное имя
    expect(await screen.findByRole('option', { name: /Characters: Erisu/ })).toBeInTheDocument();
    await user.clear(box);
    await user.type(box, 'erisu');
    await screen.findByRole('option', { name: /Characters: Erisu/ });
    await user.tab();
    expect(box).toHaveValue('Characters:Erisu');
    await user.clear(box);
    await user.type(box, 'erisu');
    await user.click(await screen.findByRole('option', { name: /Characters: Erisu/ }));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 1, name: 'eris greyrat', label: 'Erisu' }));
  });

  it('ru: подпись основная, но «erisu» по второму имени тоже находит тег', async () => {
    serve('ru');
    const { user, box } = await setup();
    await user.type(box, 'erisu');
    expect(await screen.findByRole('option', { name: /character: eris greyrat/ })).toBeInTheDocument();
  });

  it('создание с существующей категорией: в тексте варианта - её подпись', async () => {
    serve('en');
    const { user, box } = await setup();
    await user.type(box, 'characters:sylphy');
    expect(await screen.findByRole('option', { name: 'Создать тег sylphy в категории Characters' })).toBeInTheDocument();
  });
});
