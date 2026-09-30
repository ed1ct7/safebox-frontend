import type { Entry, EntryPatch } from '../api/types';
import { validateDescription } from '../lib/rules';
import { EditableField } from './EditableField';
import { TagsSection } from './TagsSection';

/**
 * Левая панель просмотрщика (лайтбокс, видео): теги и описание открытой
 * записи без выхода из полноэкранного просмотра. Закрывается ✕, а 🏷 в
 * заголовке просмотрщика возвращает её. Теги - вся работа на месте:
 * добавить, снять, «Наследуется», унаследованные с переходом к источнику;
 * клик по имени тега - фильтр по нему (просмотрщик закрывается).
 */
export function ViewerTags({
  entry,
  sourceNames,
  onOpenSource,
  onFilterTag,
  onSavePatch,
  onClose,
}: {
  entry: Entry;
  sourceNames: ReadonlyMap<number, string>;
  onOpenSource: (id: number) => void;
  onFilterTag?: (tagId: number) => void;
  /** правка описания не выходя из просмотра; нет - поля описания тоже нет */
  onSavePatch?: (id: number, patch: EntryPatch) => Promise<void>;
  onClose: () => void;
}) {
  return (
    <aside
      aria-label="Теги записи"
      className="flex w-72 shrink-0 flex-col overflow-y-auto border-r border-white/10 bg-zinc-950/90 p-3 pb-6"
    >
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-medium text-zinc-100">Теги записи</h2>
        <button
          type="button"
          aria-label="Скрыть панель тегов"
          title="Скрыть панель (вернуть — кнопка 🏷 сверху)"
          className="rounded p-1.5 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200"
          onClick={onClose}
        >
          ✕
        </button>
      </div>
      <TagsSection
        entry={entry}
        sourceNames={sourceNames}
        onOpenSource={onOpenSource}
        onFilterTag={onFilterTag}
      />
      {onSavePatch !== undefined && (
        <div className="mt-4">
          <EditableField
            label="Описание"
            value={entry.description}
            multiline
            placeholder="Заметки об этой записи"
            validate={validateDescription}
            onSave={(description) => onSavePatch(entry.id, { description })}
          />
        </div>
      )}
    </aside>
  );
}
