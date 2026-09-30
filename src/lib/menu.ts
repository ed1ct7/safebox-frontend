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

export interface MenuItem {
  action: MenuAction;
  label: string;
  hint?: string; // горячая клавиша справа
  danger?: boolean;
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
    { action: 'move', label: 'Переместить…' },
    { action: 'tags', label: 'Теги…' },
    { action: 'delete', label: 'Удалить', danger: true, separatorBefore: true },
  ];
  return items.filter((i): i is MenuItem => i !== false);
}
