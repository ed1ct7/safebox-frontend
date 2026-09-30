import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiRequestError } from '../api/client';
import type { Entry } from '../api/types';
import { makeEntry } from '../test/factories';
import { installFakeServer } from '../test/fakeServer';
import { makeCategories, makeWrapper } from '../test/tags';
import { PropertiesPanel } from './PropertiesPanel';

// секция «Теги» читает каталог с сервера
beforeEach(() => {
  installFakeServer({ 'GET /api/v1/tags': () => ({ json: { categories: makeCategories() } }) });
});
afterEach(() => vi.unstubAllGlobals());

const DATE = new Date(2025, 2, 4, 5, 6).getTime();
const DISK_DATE = new Date(2024, 0, 2, 3, 4).getTime();

function setup(
  entries: Entry[],
  opts: { scope?: 'selection' | 'container'; onSave?: (id: number, patch: object) => Promise<void> } = {},
) {
  const onSave = vi.fn(opts.onSave ?? (() => Promise.resolve()));
  const onClose = vi.fn();
  const view = render(
    <PropertiesPanel
      target={{ entries, scope: opts.scope ?? 'selection' }}
      onSave={onSave}
      onClose={onClose}
    />,
    { wrapper: makeWrapper().Wrapper },
  );
  return { onSave, onClose, user: userEvent.setup(), ...view };
}

const photo = makeEntry({
  id: 7,
  kind: 'photo',
  name: 'кот.jpg',
  mime: 'image/jpeg',
  size: 2048,
  createdAt: DATE,
  modifiedAt: DATE,
  sourceModifiedAt: DISK_DATE,
  childCount: 3,
  description: 'Первая строка\nвторая',
  hasThumbnail: true,
});

describe('PropertiesPanel: содержимое', () => {
  it('имя, тип, размер, даты, вложения и описание', () => {
    setup([photo]);
    expect(screen.getByRole('complementary', { name: 'Свойства' })).toBeInTheDocument();
    expect(screen.getByLabelText('Имя')).toHaveValue('кот.jpg');
    expect(screen.getByLabelText('Описание')).toHaveValue('Первая строка\nвторая');
    expect(screen.getByText('Фото · image/jpeg')).toBeInTheDocument();
    expect(screen.getByText('2.0 КБ')).toBeInTheDocument();
    expect(screen.getAllByText('04.03.2025 05:06')).toHaveLength(2); // создано и изменено
    expect(screen.getByText('Изменён на диске')).toBeInTheDocument();
    expect(screen.getByText('02.01.2024 03:04')).toBeInTheDocument();
    expect(screen.getByText('Вложения').nextElementSibling).toHaveTextContent('3');
  });

  it('превью - миниатюра, если она есть', () => {
    const { container } = setup([photo]);
    expect(container.querySelector('img')?.getAttribute('src')).toMatch(/^\/api\/v1\/media\/7\/thumbnail/);
  });

  it('«изменён на диске» показывается, только если дата известна', () => {
    setup([{ ...photo, sourceModifiedAt: null }]);
    expect(screen.queryByText('Изменён на диске')).toBeNull();
  });

  it('у ссылки есть адрес, у файла - нет', () => {
    const { unmount } = setup([makeEntry({ kind: 'link', url: 'https://example.com/x', name: 'Пример' })]);
    expect(screen.getByLabelText('Адрес')).toHaveValue('https://example.com/x');
    unmount();
    setup([makeEntry()]);
    expect(screen.queryByLabelText('Адрес')).toBeNull();
  });

  it('у папки - «Содержимое» вместо размера и вложений', () => {
    setup([makeEntry({ kind: 'folder', childCount: 5 })]);
    expect(screen.queryByText('Размер')).toBeNull();
    expect(screen.getByText('Содержимое').nextElementSibling).toHaveTextContent('5');
  });

  it('секция «Теги»: теги записи по категориям и поле добавления', async () => {
    setup([{ ...photo, tags: [{ tagId: 1, inherit: false }, { tagId: 5, inherit: true }] }]);
    const tags = screen.getByRole('region', { name: 'Теги' });
    expect(within(tags).getByRole('combobox', { name: 'Добавить тег' })).toBeInTheDocument();
    expect(await within(tags).findByRole('button', { name: 'Снять тег «character: eris greyrat»' })).toBeInTheDocument();
    expect(within(tags).getByRole('button', { name: 'Снять тег «language: ru»' })).toBeInTheDocument();
    expect(within(tags).getByRole('checkbox', { name: 'Наследуется' })).not.toBeChecked();
  });

  it('клик по имени тега в «Тегах» - фильтр по нему (onFilterTag)', async () => {
    const onFilterTag = vi.fn();
    render(
      <PropertiesPanel
        target={{ entries: [{ ...photo, tags: [{ tagId: 1, inherit: false }] }], scope: 'selection' }}
        onSave={vi.fn(() => Promise.resolve())}
        onClose={vi.fn()}
        onFilterTag={onFilterTag}
      />,
      { wrapper: makeWrapper().Wrapper },
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'character: eris greyrat' }));
    expect(onFilterTag).toHaveBeenCalledWith(1);
  });

  it('несколько записей - сводка без полей, ничего - подсказка', () => {
    const { unmount } = setup([photo, makeEntry({ id: 8, size: 1024 })]);
    expect(screen.getByText('Выбрано: 2 объекта')).toBeInTheDocument();
    expect(screen.queryByLabelText('Имя')).toBeNull();
    unmount();
    setup([]);
    expect(screen.getByText(/Выделите запись/)).toBeInTheDocument();
  });

  it('открытая папка - помечена в заголовке', () => {
    setup([makeEntry({ kind: 'folder', name: 'Отпуск' })], { scope: 'container' });
    expect(screen.getByText('открытая папка')).toBeInTheDocument();
  });

  it('крестик закрывает панель', async () => {
    const { user, onClose } = setup([photo]);
    await user.click(screen.getByRole('button', { name: /Закрыть свойства/ }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe('PropertiesPanel: правка на месте', () => {
  it('имя сохраняется при уходе из поля', async () => {
    const { user, onSave } = setup([photo]);
    const name = screen.getByLabelText('Имя');
    await user.clear(name);
    await user.type(name, 'кошка.jpg');
    expect(onSave).not.toHaveBeenCalled();
    await user.tab();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(7, { name: 'кошка.jpg' });
  });

  it('Enter в имени тоже фиксирует', async () => {
    const { user, onSave } = setup([photo]);
    const name = screen.getByLabelText('Имя');
    await user.clear(name);
    await user.type(name, 'новое.jpg{Enter}');
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(7, { name: 'новое.jpg' });
  });

  it('описание многострочное: Enter - новая строка, сохраняется при уходе', async () => {
    const { user, onSave } = setup([makeEntry({ id: 3, description: '' })]);
    const field = screen.getByLabelText('Описание');
    await user.type(field, 'раз{Enter}два');
    expect(onSave).not.toHaveBeenCalled();
    await user.tab();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(3, { description: 'раз\nдва' });
  });

  it('адрес ссылки сохраняется отдельным полем', async () => {
    const { user, onSave } = setup([makeEntry({ id: 4, kind: 'link', url: 'https://a.com', name: 'A' })]);
    const url = screen.getByLabelText('Адрес');
    await user.clear(url);
    await user.type(url, ' https://b.com/x {Enter}');
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(4, { url: 'https://b.com/x' });
  });

  it('без изменений запроса нет', async () => {
    const { user, onSave } = setup([photo]);
    await user.click(screen.getByLabelText('Имя'));
    await user.tab();
    await user.click(screen.getByLabelText('Описание'));
    await user.tab();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('Esc отменяет правку без запроса и не закрывает панель', async () => {
    const { user, onSave, onClose } = setup([photo]);
    const name = screen.getByLabelText('Имя');
    await user.type(name, 'хвост');
    await user.keyboard('{Escape}');
    expect(name).toHaveValue('кот.jpg');
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(name).not.toHaveFocus();
  });

  it('недопустимое имя - сообщение под полем, запроса нет', async () => {
    const { user, onSave } = setup([photo]);
    const name = screen.getByLabelText('Имя');
    await user.clear(name);
    await user.type(name, 'а/б');
    await user.tab();
    expect(screen.getByRole('alert')).toHaveTextContent('запрещены');
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('адрес не http(s) - сообщение под полем', async () => {
    const { user, onSave } = setup([makeEntry({ kind: 'link', url: 'https://a.com', name: 'A' })]);
    const url = screen.getByLabelText('Адрес');
    await user.clear(url);
    await user.type(url, 'ftp://x{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent('http');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('422 сервера - под полем, введённый текст остаётся', async () => {
    const onSave = vi.fn(() =>
      Promise.reject(new ApiRequestError(422, 'invalid_argument', 'Имя уже занято')),
    );
    const { user } = setup([photo], { onSave });
    const name = screen.getByLabelText('Имя');
    await user.clear(name);
    await user.type(name, 'занято.jpg{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('Имя уже занято');
    expect(name).toHaveValue('занято.jpg');
    // правка стирает ошибку
    await user.type(name, 'x');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('при смене записи черновики не переходят на другую запись', async () => {
    const { user, rerender, onSave, onClose } = setup([photo]);
    await user.type(screen.getByLabelText('Имя'), 'черновик');
    rerender(
      <PropertiesPanel
        target={{ entries: [makeEntry({ id: 9, name: 'другая.txt' })], scope: 'selection' }}
        onSave={onSave}
        onClose={onClose}
      />,
    );
    expect(screen.getByLabelText('Имя')).toHaveValue('другая.txt');
  });

  it('значение обновилось на сервере - поле подхватывает, пока не правим', () => {
    const { rerender, onSave, onClose } = setup([photo]);
    rerender(
      <PropertiesPanel
        target={{ entries: [{ ...photo, description: 'обновлено' }], scope: 'selection' }}
        onSave={onSave}
        onClose={onClose}
      />,
    );
    expect(screen.getByLabelText('Описание')).toHaveValue('обновлено');
  });
});
