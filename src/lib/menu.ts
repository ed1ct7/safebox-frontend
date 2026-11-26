import type { Entry } from '../api/types';

// Пункты контекстного меню карточки (UF-10, UF-6, UF-11, UF-14, UF-16, UF-22).

export type MenuAction =
  | 'open'
  | 'openAttachments'
  | 'download'
  | 'downloadAttachments'
  | 'copyLink'
  | 'refreshPreview'
  | 'properties'
  | 'rename'
  | 'move'
  | 'tags'
  | 'delete';

export interface MenuItem<A extends string = MenuAction> {
  action: A;
  label: string;
  hint?: string; // горячая клавиша справа
  title?: string; // подсказка при наведении
  danger?: boolean;
  disabled?: boolean;
  separatorBefore?: boolean;
}

export function menuItemsFor(entry: Entry): MenuItem[] {
  const isLink = entry.kind === 'link';
  // у папки вложения = содержимое: «Открыть» и «Скачать» (zip) уже про них
  const hasAttachments = entry.kind !== 'folder' && entry.childCount > 0;
  const items: (MenuItem | false)[] = [
    { action: 'open', label: 'Открыть' },
    hasAttachments && { action: 'openAttachments', label: 'Открыть вложения' },
    { action: 'download', label: isLink ? 'Скачать ярлык' : 'Скачать' },
    hasAttachments && { action: 'downloadAttachments', label: 'Скачать вложения' },
    isLink && { action: 'copyLink', label: 'Копировать адрес' },
    isLink && { action: 'refreshPreview', label: 'Обновить предпросмотр' },
    { action: 'properties', label: 'Свойства', hint: 'Alt+Enter', separatorBefore: true },
    { action: 'rename', label: 'Переименовать', hint: 'F2' },
    { action: 'move', label: 'Переместить…', hint: 'M' },
    { action: 'tags', label: 'Теги…' },
    { action: 'delete', label: 'Удалить', danger: true, separatorBefore: true },
  ];
  return items.filter((i): i is MenuItem => i !== false);
}

// Меню папки в дереве: правый клик по узлу; по «Все объекты» - только новая папка.

export type FolderMenuAction =
  | 'open'
  | 'newFolder'
  | 'rename'
  | 'move'
  | 'place'
  | 'properties'
  | 'download'
  | 'delete';

export function folderMenuItems({
  isRoot,
  placeDigit,
  placesFull,
}: {
  isRoot: boolean;
  /** цифра, если папка уже в «Местах» */
  placeDigit: number | undefined;
  placesFull: boolean;
}): MenuItem<FolderMenuAction>[] {
  if (isRoot) return [{ action: 'newFolder', label: 'Новая папка…' }];
  return [
    { action: 'open', label: 'Открыть' },
    { action: 'newFolder', label: 'Новая подпапка…' },
    { action: 'rename', label: 'Переименовать…', separatorBefore: true },
    { action: 'move', label: 'Переместить…' },
    placeDigit !== undefined
      ? { action: 'place', label: 'Убрать из «Мест»', hint: String(placeDigit) }
      : {
          action: 'place',
          label: 'Добавить в «Места»',
          disabled: placesFull,
          title: placesFull
            ? 'Все 9 мест заняты - сначала уберите одно'
            : 'Цифра 1–9 в просмотре и галерее перемещает сюда выделенное',
        },
    { action: 'properties', label: 'Свойства и теги', separatorBefore: true },
    { action: 'download', label: 'Скачать ZIP' },
    { action: 'delete', label: 'В корзину', danger: true, separatorBefore: true },
  ];
}
