import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Entry } from '../api/types';
import { makeEntry } from '../test/factories';
import { installFakeServer } from '../test/fakeServer';
import { makeCategories, makeWrapper } from '../test/tags';
import { ContextMenu } from './ContextMenu';
import { EntryCard } from './EntryCard';
import type { EntryCardHandlers } from './EntryCard';

const handlers = (): EntryCardHandlers => ({
  onClick: vi.fn(),
  onToggleSelect: vi.fn(),
  onContextMenu: vi.fn(),
  onRenameStart: vi.fn(),
  onRenameCommit: vi.fn(),
  onRenameCancel: vi.fn(),
  onHover: vi.fn(),
  onDragStart: vi.fn(),
  onDragEnd: vi.fn(),
  canDropOn: vi.fn(() => false),
  onDropOn: vi.fn(),
});

function card(entry: Entry, extra: { caption?: string; matchedIn?: 'name' | 'description' | null } = {}) {
  return render(
    <EntryCard entry={entry} selected={false} renaming={false} handlers={handlers()} {...extra} />,
  );
}

describe('EntryCard: вложения (UF-14)', () => {
  it('бейдж с числом вложений, если они есть', () => {
    card(makeEntry({ kind: 'photo', childCount: 3 }));
    expect(screen.getByTitle('Вложений: 3')).toHaveTextContent('3');
  });

  it('у папки бейдж считает элементы', () => {
    card(makeEntry({ kind: 'folder', childCount: 12 }));
    expect(screen.getByTitle('Элементов: 12')).toHaveTextContent('12');
  });

  it('без вложений бейджа нет', () => {
    card(makeEntry({ childCount: 0 }));
    expect(screen.queryByTitle(/Вложений|Элементов/)).toBeNull();
  });
});

describe('EntryCard: ссылка (UF-6)', () => {
  const link = makeEntry({
    id: 5,
    kind: 'link',
    name: 'Заголовок страницы',
    url: 'https://example.com/x',
    domain: 'example.com',
    description: '\nПервая строка описания\nВторая строка',
    hasThumbnail: true,
    modifiedAt: 77,
  });

  it('картинка предпросмотра, название, домен и первая строка описания', () => {
    const { container } = card(link);
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/api/v1/media/5/thumbnail?v=77.0');
    expect(screen.getByText('Заголовок страницы')).toBeInTheDocument();
    expect(screen.getByText('example.com')).toBeInTheDocument();
    expect(screen.getByText('Первая строка описания')).toBeInTheDocument();
    expect(screen.queryByText(/Вторая строка/)).toBeNull();
  });

  it('без картинки - прежняя заглушка', () => {
    const { container } = card({ ...link, hasThumbnail: false });
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getAllByText('🔗').length).toBeGreaterThan(0);
  });

  it('картинка не загрузилась - тоже заглушка', () => {
    const { container } = card(link);
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    img?.dispatchEvent(new Event('error'));
    return vi.waitFor(() => expect(container.querySelector('img')).toBeNull());
  });

  it('старое имя ярлыка показывается без «.url»', () => {
    card({ ...link, name: 'example.com — x.url' });
    expect(screen.getByText('example.com — x')).toBeInTheDocument();
  });
});

describe('EntryCard: описание и поиск', () => {
  it('у не-ссылок первая строка описания - во всплывающей подсказке', () => {
    const { container } = card(makeEntry({ kind: 'photo', name: 'кот.jpg', description: 'Рыжий\nна диване' }));
    expect(container.firstElementChild).toHaveAttribute('title', 'кот.jpg\nРыжий');
  });

  it('нет описания - подсказка только имя', () => {
    const { container } = card(makeEntry({ name: 'a.txt' }));
    expect(container.firstElementChild).toHaveAttribute('title', 'a.txt');
  });

  it('совпадение в описании помечено на карточке (UF-8)', () => {
    card(makeEntry(), { matchedIn: 'description', caption: 'Папка / Вложенная' });
    expect(screen.getByText('в описании')).toBeInTheDocument();
  });

  it('совпадение в имени не помечается', () => {
    card(makeEntry(), { matchedIn: 'name' });
    expect(screen.queryByText('в описании')).toBeNull();
  });
});

describe('EntryCard: перетаскивание', () => {
  it('карточку можно тащить, а в режиме переименования - нет', () => {
    const { container, rerender } = card(makeEntry());
    expect(container.firstElementChild).toHaveAttribute('draggable', 'true');
    rerender(<EntryCard entry={makeEntry()} selected={false} renaming handlers={handlers()} />);
    expect(container.firstElementChild).toHaveAttribute('draggable', 'false');
  });
});

describe('EntryCard: теги (UF-16)', () => {
  beforeEach(() => {
    installFakeServer({ 'GET /api/v1/tags': () => ({ json: { categories: makeCategories() } }) });
  });
  afterEach(() => vi.unstubAllGlobals());

  const tags = (...ids: number[]) => ids.map((tagId) => ({ tagId, inherit: false }));

  function tagCard(entry: Entry) {
    render(<EntryCard entry={entry} selected={false} renaming={false} handlers={handlers()} />, {
      wrapper: makeWrapper().Wrapper,
    });
  }

  it('первые три тега маленькими чипами и «+N» за краем', async () => {
    tagCard(makeEntry({ tags: tags(5, 2, 1), inheritedTags: [{ tagId: 1, fromId: 9 }] }));
    const chips = await screen.findByLabelText('Теги');
    expect(within(chips).getAllByText(/./).map((c) => c.textContent)).toEqual([
      'eris greyrat',
      'roxy migurdia',
      'ru',
      '+1',
    ]);
    expect(within(chips).getByText('+1')).toHaveAttribute('title', 'Ещё тегов: 1');
  });

  it('у чипа в подсказке «категория: тег»', async () => {
    tagCard(makeEntry({ tags: tags(1) }));
    expect(await screen.findByTitle('character: eris greyrat')).toHaveTextContent('eris greyrat');
  });

  it('унаследованные - после прямых и бледнее', async () => {
    tagCard(makeEntry({ tags: tags(5), inheritedTags: [{ tagId: 1, fromId: 9 }] }));
    const own = await screen.findByTitle('language: ru');
    const inherited = screen.getByTitle('character: eris greyrat (унаследован)');
    expect(own.className).toMatch(/text-zinc-300/);
    expect(inherited.className).toMatch(/text-zinc-600/);
    expect(own.compareDocumentPosition(inherited) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('без тегов блока нет', async () => {
    tagCard(makeEntry());
    expect(screen.queryByLabelText('Теги')).toBeNull();
  });

  it('пока каталог тегов не загружен, чипов нет и карточка не ломается', () => {
    tagCard(makeEntry({ name: 'кот.jpg', tags: tags(1) }));
    expect(screen.getByText('кот.jpg')).toBeInTheDocument();
  });
});

describe('ContextMenu', () => {
  it('пункты по типу записи, выбор вызывает действие и закрывает меню', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    const onClose = vi.fn();
    const entry = makeEntry({ id: 9, kind: 'link', url: 'https://example.com', childCount: 2 });
    render(<ContextMenu state={{ x: 10, y: 10, entry }} onClose={onClose} onAction={onAction} />);
    const names = screen.getAllByRole('menuitem').map((i) => i.textContent);
    expect(names).toEqual([
      'Открыть',
      'Открыть вложения',
      'Скачать ярлык',
      'Скачать вложения',
      'Копировать адрес',
      'Обновить предпросмотр',
      'СвойстваAlt+Enter',
      'ПереименоватьF2',
      'Переместить…',
      'Теги…',
      'Удалить',
    ]);
    await user.click(screen.getByRole('menuitem', { name: 'Обновить предпросмотр' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onAction).toHaveBeenCalledWith('refreshPreview', entry);
  });
});

describe('EntryCard: предпросмотр ссылки (UF-21)', () => {
  const link = makeEntry({ kind: 'link', url: 'https://example.com/', domain: 'example.com', name: 'Пример' });

  it('пока предпросмотр в очереди - ненавязчивый индикатор рядом с доменом', () => {
    card({ ...link, previewPending: true });
    expect(screen.getByRole('img', { name: 'Загружается предпросмотр' })).toBeInTheDocument();
    expect(screen.getByText('example.com')).toBeInTheDocument();
  });

  it('очереди нет (или флага нет вовсе) - индикатора нет', () => {
    const view = card({ ...link, previewPending: false });
    expect(screen.queryByRole('img', { name: 'Загружается предпросмотр' })).toBeNull();
    view.unmount();
    card(link);
    expect(screen.queryByRole('img', { name: 'Загружается предпросмотр' })).toBeNull();
  });
});

describe('EntryCard: только что добавлена (UF-20)', () => {
  it('подсветка по fresh, без выделения', () => {
    const { container, rerender } = card(makeEntry());
    expect(container.firstElementChild?.className).not.toContain('border-emerald-600');
    rerender(<EntryCard entry={makeEntry()} selected={false} renaming={false} fresh handlers={handlers()} />);
    expect(container.firstElementChild?.className).toContain('border-emerald-600');
  });
});

describe('EntryCard: ссылка из браузера брошена на карточку (UF-20)', () => {
  const dataOf = (data: Record<string, string>, extra: string[] = []) => ({
    types: [...Object.keys(data), ...extra],
    getData: (type: string) => data[type] ?? '',
    dropEffect: '',
  });

  function droppable(entry: Entry) {
    const h = { ...handlers(), onDropLink: vi.fn() };
    const view = render(<EntryCard entry={entry} selected={false} renaming={false} handlers={h} />);
    return { h, root: view.container.firstElementChild as HTMLElement };
  }

  it('drop ссылки зовёт onDropLink с записью и переносом', () => {
    const entry = makeEntry({ id: 7 });
    const { h, root } = droppable(entry);
    const dt = dataOf({ 'text/uri-list': 'https://a.com/', 'text/plain': 'https://a.com/' });
    expect(fireEvent.dragOver(root, { dataTransfer: dt })).toBe(false); // drop разрешён
    fireEvent.drop(root, { dataTransfer: dt });
    expect(h.onDropLink).toHaveBeenCalledTimes(1);
    expect(h.onDropLink).toHaveBeenCalledWith(entry, expect.objectContaining({ types: dt.types }));
    expect(h.onDropOn).not.toHaveBeenCalled();
  });

  it('пока ссылка над карточкой - рамка-подсветка, после ухода - снята', () => {
    const { root } = droppable(makeEntry());
    const dt = dataOf({ 'text/plain': 'https://a.com/' });
    fireEvent.dragEnter(root, { dataTransfer: dt });
    expect(root.className).toContain('ring-accent');
    fireEvent.dragLeave(root, { dataTransfer: dt });
    expect(root.className).not.toContain('ring-2');
  });

  it('файлы из проводника карточка не берёт: событие идёт к окну', () => {
    const { h, root } = droppable(makeEntry());
    const dt = dataOf({}, ['Files']);
    expect(fireEvent.dragOver(root, { dataTransfer: dt })).toBe(true);
    fireEvent.drop(root, { dataTransfer: dt });
    expect(h.onDropLink).not.toHaveBeenCalled();
    expect(h.onDropOn).not.toHaveBeenCalled();
  });

  it('перенос карточек по-прежнему идёт в onDropOn', () => {
    const h = { ...handlers(), onDropLink: vi.fn(), canDropOn: vi.fn(() => true) };
    const view = render(<EntryCard entry={makeEntry()} selected={false} renaming={false} handlers={h} />);
    const dt = dataOf({ 'application/x-safebox-entries': '1' });
    fireEvent.drop(view.container.firstElementChild as HTMLElement, { dataTransfer: dt });
    expect(h.onDropOn).toHaveBeenCalledTimes(1);
    expect(h.onDropLink).not.toHaveBeenCalled();
  });

  it('без onDropLink ссылку карточка не принимает', () => {
    const { container } = card(makeEntry());
    const dt = dataOf({ 'text/plain': 'https://a.com/' });
    expect(fireEvent.dragOver(container.firstElementChild as HTMLElement, { dataTransfer: dt })).toBe(true);
  });
});
