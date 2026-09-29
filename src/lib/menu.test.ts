import { describe, expect, it } from 'vitest';
import { makeEntry } from '../test/factories';
import { menuItemsFor } from './menu';

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

  it('ссылка - Открыть, Копировать адрес, Свойства, Обновить предпросмотр; скачивать нечего', () => {
    const l = labels(makeEntry({ kind: 'link', url: 'https://example.com' }));
    expect(l).toEqual([
      'Открыть',
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
    expect(l).not.toContain('Скачать');
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
