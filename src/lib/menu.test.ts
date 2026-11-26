import { describe, expect, it } from 'vitest';
import { makeEntry } from '../test/factories';
import { folderMenuItems, menuItemsFor } from './menu';

const labels = (entry = makeEntry()) => menuItemsFor(entry).map((i) => i.label);

describe('menuItemsFor', () => {
  it('обычный файл', () => {
    expect(labels(makeEntry({ kind: 'file' }))).toEqual([
      'Открыть',
      'Скачать',
      'Свойства',
      'Переименовать',
      'Переместить…',
      'Теги…',
      'Удалить',
    ]);
  });

  it('с вложениями - «Открыть вложения» и «Скачать вложения», а «Скачать» остаётся скачиванием файла', () => {
    expect(labels(makeEntry({ kind: 'photo', childCount: 3 }))).toEqual([
      'Открыть',
      'Открыть вложения',
      'Скачать',
      'Скачать вложения',
      'Свойства',
      'Переименовать',
      'Переместить…',
      'Теги…',
      'Удалить',
    ]);
  });

  it('у папки вложений в меню нет: «Открыть» и «Скачать» (zip) уже про содержимое', () => {
    const l = labels(makeEntry({ kind: 'folder', childCount: 4 }));
    expect(l).not.toContain('Открыть вложения');
    expect(l).not.toContain('Скачать вложения');
    expect(l).toContain('Скачать');
  });

  it('ссылка - Открыть, Скачать ярлык, Копировать адрес, Обновить предпросмотр, Свойства', () => {
    const l = labels(makeEntry({ kind: 'link', url: 'https://example.com' }));
    expect(l).toEqual([
      'Открыть',
      'Скачать ярлык',
      'Копировать адрес',
      'Обновить предпросмотр',
      'Свойства',
      'Переименовать',
      'Переместить…',
      'Теги…',
      'Удалить',
    ]);
  });

  it('у ссылки с вложениями есть и вложения, и пункты ссылки', () => {
    const l = labels(makeEntry({ kind: 'link', url: 'https://example.com', childCount: 1 }));
    expect(l).toContain('Открыть вложения');
    expect(l).toContain('Скачать вложения');
    expect(l).toContain('Копировать адрес');
    expect(l).toContain('Скачать ярлык'); // .url с адресом
  });

  it('«Теги…» есть у записи любого вида, сразу после «Переместить…»', () => {
    for (const kind of ['file', 'photo', 'video', 'link', 'folder'] as const) {
      const l = labels(makeEntry({ kind }));
      expect(l[l.indexOf('Переместить…') + 1]).toBe('Теги…');
    }
  });

  it('«Удалить» - опасное действие, «Свойства» подсказывают Alt+Enter', () => {
    const items = menuItemsFor(makeEntry());
    expect(items.find((i) => i.action === 'delete')?.danger).toBe(true);
    expect(items.find((i) => i.action === 'properties')?.hint).toBe('Alt+Enter');
  });
});

describe('folderMenuItems', () => {
  const labels = (o: Parameters<typeof folderMenuItems>[0]) => folderMenuItems(o).map((i) => i.label);

  it('«Все объекты» - только новая папка', () => {
    expect(labels({ isRoot: true, placeDigit: undefined, placesFull: false })).toEqual(['Новая папка…']);
  });

  it('папка: полный набор; уже в «Местах» - «Убрать» с цифрой', () => {
    expect(labels({ isRoot: false, placeDigit: undefined, placesFull: false })).toEqual([
      'Открыть',
      'Новая подпапка…',
      'Переименовать…',
      'Переместить…',
      'Добавить в «Места»',
      'Свойства и теги',
      'Скачать ZIP',
      'В корзину',
    ]);
    const place = folderMenuItems({ isRoot: false, placeDigit: 4, placesFull: true }).find((i) => i.action === 'place');
    expect(place).toMatchObject({ label: 'Убрать из «Мест»', hint: '4' });
    expect(place?.disabled).toBeUndefined();
  });

  it('все места заняты - «Добавить» недоступно', () => {
    const place = folderMenuItems({ isRoot: false, placeDigit: undefined, placesFull: true }).find((i) => i.action === 'place');
    expect(place?.disabled).toBe(true);
  });
});
