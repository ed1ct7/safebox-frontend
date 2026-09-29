import type { Entry } from '../api/types';

/** Запись для тестов: разумные значения по умолчанию, лишнее переопределяется. */
export function makeEntry(extra: Partial<Entry> = {}): Entry {
  return {
    id: 1,
    parentId: null,
    kind: 'file',
    name: 'файл.txt',
    size: 40,
    mime: '',
    hasThumbnail: false,
    createdAt: 0,
    modifiedAt: 0,
    description: '',
    childCount: 0,
    tags: [],
    inheritedTags: [],
    sourceModifiedAt: null,
    ...extra,
  };
}
