import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { Entry } from '../api/types';
import { useEntryDnd } from '../hooks/useEntryDnd';
import { DRAG_MIME } from '../lib/move';
import { makeEntry } from '../test/factories';
import { FolderTree } from './FolderTree';
import { Gallery } from './Gallery';
import type { EntryCardHandlers } from './EntryCard';

// Перетаскивание карточек (UF-14): карточка -> карточка папки/записи и узел дерева.

const photo1 = makeEntry({ id: 1, kind: 'photo', name: 'один.jpg', parentId: null });
const photo2 = makeEntry({ id: 2, kind: 'photo', name: 'два.jpg', parentId: null });
const folder = makeEntry({ id: 10, kind: 'folder', name: 'Папка', parentId: null });
const inner = makeEntry({ id: 11, kind: 'photo', name: 'внутри.jpg', parentId: 10 });

function transfer(types: string[] = [DRAG_MIME]) {
  return { types, setData: vi.fn(), getData: vi.fn(), effectAllowed: '', dropEffect: '' };
}

function Harness({
  entries,
  selected,
  onMove,
  withTree = false,
}: {
  entries: Entry[];
  selected: number[];
  onMove: (moving: Entry[], parent: number | null) => void;
  withTree?: boolean;
}) {
  const selection = useMemo(() => new Set(selected), [selected]);
  const dnd = useEntryDnd({ entries, selected: selection, onMove });
  const handlers: EntryCardHandlers = {
    onClick: vi.fn(),
    onToggleSelect: vi.fn(),
    onContextMenu: vi.fn(),
    onRenameStart: vi.fn(),
    onRenameCommit: vi.fn(),
    onRenameCancel: vi.fn(),
    onHover: vi.fn(),
    ...dnd.card,
  };
  return (
    <>
      <Gallery
        items={entries.map((entry) => ({ entry }))}
        loading={false}
        isSearch={false}
        selection={selection}
        renamingId={null}
        handlers={handlers}
      />
      {withTree && <FolderTree current={null} onNavigate={vi.fn()} dnd={dnd.tree} />}
    </>
  );
}

function renderHarness(props: Parameters<typeof Harness>[0], folders: Entry[] = []) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(['folders'], {
    folders: folders.map((f) => ({ id: f.id, parentId: f.parentId, name: f.name })),
  });
  return render(
    <QueryClientProvider client={qc}>
      <Harness {...props} />
    </QueryClientProvider>,
  );
}

// у карточки title и на корне, и на бейдже типа: корень - единственный draggable
const cardOf = (name: string) => {
  const el = screen.getAllByTitle(name).find((e) => e.hasAttribute('draggable'));
  if (el === undefined) throw new Error(`нет карточки «${name}»`);
  return el;
};

describe('перетаскивание карточек', () => {
  it('невыделенная карточка на карточку папки - переносится одна', () => {
    const onMove = vi.fn();
    renderHarness({ entries: [photo1, photo2, folder], selected: [], onMove });
    const dt = transfer();
    fireEvent.dragStart(cardOf('один.jpg'), { dataTransfer: dt });
    expect(dt.setData).toHaveBeenCalledWith(DRAG_MIME, '1');
    fireEvent.dragOver(cardOf('Папка'), { dataTransfer: dt });
    fireEvent.drop(cardOf('Папка'), { dataTransfer: dt });
    expect(onMove).toHaveBeenCalledWith([photo1], 10);
  });

  it('карточка выделенных тянет всех выделенных', () => {
    const onMove = vi.fn();
    renderHarness({ entries: [photo1, photo2, folder], selected: [1, 2], onMove });
    const dt = transfer();
    fireEvent.dragStart(cardOf('два.jpg'), { dataTransfer: dt });
    fireEvent.drop(cardOf('Папка'), { dataTransfer: dt });
    expect(onMove).toHaveBeenCalledWith([photo1, photo2], 10);
  });

  it('на обычную запись - она становится родителем (вложением)', () => {
    const onMove = vi.fn();
    renderHarness({ entries: [photo1, photo2], selected: [], onMove });
    const dt = transfer();
    fireEvent.dragStart(cardOf('один.jpg'), { dataTransfer: dt });
    fireEvent.drop(cardOf('два.jpg'), { dataTransfer: dt });
    expect(onMove).toHaveBeenCalledWith([photo1], 2);
  });

  it('на саму себя и на выделенную соседку нельзя', () => {
    const onMove = vi.fn();
    renderHarness({ entries: [photo1, photo2], selected: [1, 2], onMove });
    const dt = transfer();
    fireEvent.dragStart(cardOf('один.jpg'), { dataTransfer: dt });
    const over = fireEvent.dragOver(cardOf('два.jpg'), { dataTransfer: dt });
    expect(over).toBe(true); // не отменено: сброс здесь не принимается
    fireEvent.drop(cardOf('один.jpg'), { dataTransfer: dt });
    fireEvent.drop(cardOf('два.jpg'), { dataTransfer: dt });
    expect(onMove).not.toHaveBeenCalled();
  });

  it('принимающая карточка подсвечивается и снимает подсветку', () => {
    renderHarness({ entries: [photo1, folder], selected: [], onMove: vi.fn() });
    const dt = transfer();
    fireEvent.dragStart(cardOf('один.jpg'), { dataTransfer: dt });
    fireEvent.dragEnter(cardOf('Папка'), { dataTransfer: dt });
    expect(cardOf('Папка').className).toContain('ring-accent');
    fireEvent.dragLeave(cardOf('Папка'), { dataTransfer: dt });
    expect(cardOf('Папка').className).not.toContain('ring-2');
  });

  it('dragover над допустимой целью отменяется (иначе браузер не даст бросить)', () => {
    renderHarness({ entries: [photo1, folder], selected: [], onMove: vi.fn() });
    const dt = transfer();
    fireEvent.dragStart(cardOf('один.jpg'), { dataTransfer: dt });
    expect(fireEvent.dragOver(cardOf('Папка'), { dataTransfer: dt })).toBe(false);
  });

  it('файлы из проводника не считаются переносом карточек - они уходят в импорт', () => {
    const onMove = vi.fn();
    renderHarness({ entries: [photo1, folder], selected: [], onMove });
    const dt = transfer(['Files']);
    expect(fireEvent.dragOver(cardOf('Папка'), { dataTransfer: dt })).toBe(true);
    fireEvent.drop(cardOf('Папка'), { dataTransfer: dt });
    expect(onMove).not.toHaveBeenCalled();
  });

  it('после dragend перенос забыт', () => {
    const onMove = vi.fn();
    renderHarness({ entries: [photo1, folder], selected: [], onMove });
    const dt = transfer();
    fireEvent.dragStart(cardOf('один.jpg'), { dataTransfer: dt });
    fireEvent.dragEnd(cardOf('один.jpg'), { dataTransfer: dt });
    fireEvent.drop(cardOf('Папка'), { dataTransfer: dt });
    expect(onMove).not.toHaveBeenCalled();
  });

  it('запись уже лежит там, куда её бросают - переносить нечего', () => {
    const onMove = vi.fn();
    renderHarness({ entries: [inner], selected: [], onMove, withTree: true }, [folder]);
    const dt = transfer();
    fireEvent.dragStart(cardOf('внутри.jpg'), { dataTransfer: dt });
    fireEvent.drop(screen.getByRole('button', { name: /Папка/ }), { dataTransfer: dt });
    expect(onMove).not.toHaveBeenCalled();
  });
});

describe('перетаскивание на дерево папок', () => {
  it('на узел дерева - в эту папку, на «Все объекты» - в корень', () => {
    const onMove = vi.fn();
    renderHarness({ entries: [inner, photo1], selected: [], onMove, withTree: true }, [folder]);
    const dt = transfer();
    const root = screen.getByRole('button', { name: /Все объекты/ });
    fireEvent.dragStart(cardOf('внутри.jpg'), { dataTransfer: dt });
    fireEvent.drop(root, { dataTransfer: dt });
    expect(onMove).toHaveBeenLastCalledWith([inner], null);

    fireEvent.dragStart(cardOf('один.jpg'), { dataTransfer: dt });
    fireEvent.drop(screen.getByRole('button', { name: /Папка/ }), { dataTransfer: dt });
    expect(onMove).toHaveBeenLastCalledWith([photo1], 10);
  });

  it('папку нельзя бросить на неё саму и на её подпапку', () => {
    const sub = makeEntry({ id: 12, kind: 'folder', name: 'Подпапка', parentId: 10 });
    const onMove = vi.fn();
    renderHarness({ entries: [folder], selected: [], onMove, withTree: true }, [folder, sub]);
    // дерево свернуто: раскрываем, чтобы «Подпапка» появилась
    fireEvent.click(screen.getByRole('button', { name: 'Развернуть' }));
    const dt = transfer();
    fireEvent.dragStart(cardOf('Папка'), { dataTransfer: dt });
    fireEvent.drop(screen.getByRole('button', { name: /Подпапка/ }), { dataTransfer: dt });
    fireEvent.drop(screen.getByRole('button', { name: /^📁 Папка$/ }), { dataTransfer: dt });
    expect(onMove).not.toHaveBeenCalled();
  });
});
