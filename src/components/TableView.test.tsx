import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TableConflictError } from '../api/tables';
import { parseTable, serializeTable } from '../lib/table';
import type { TableDoc } from '../lib/table';
import { makeEntry } from '../test/factories';
import { TableView } from './TableView';
import { ToastProvider } from './Toasts';

// Экран таблицы целиком: сетка, правка с автосохранением, секреты, поиск, конфликт,
// закрытие. Сейф подставной: loadTable отдаёт таблицу, saveTableText запоминает текст.

const mocks = vi.hoisted(() => ({
  loadTable: vi.fn(),
  saveTableText: vi.fn(),
  copyText: vi.fn(),
  triggerDownload: vi.fn(),
}));

vi.mock('../api/tables', async (original) => ({
  ...(await original<typeof import('../api/tables')>()),
  loadTable: mocks.loadTable,
  saveTableText: mocks.saveTableText,
}));
vi.mock('../lib/dom', async (original) => ({
  ...(await original<typeof import('../lib/dom')>()),
  copyText: mocks.copyText,
  triggerDownload: mocks.triggerDownload,
}));

const entry = makeEntry({ id: 7, name: 'Пароли.sbtable', modifiedAt: 100 });

const initial: TableDoc = {
  columns: [
    { id: 'c1', name: 'Сервис', type: 'text' },
    { id: 'c2', name: 'Пароль', type: 'secret' },
    { id: 'c3', name: 'Сайт', type: 'url' },
  ],
  rows: [
    { id: 'r1', cells: { c1: 'Почта', c2: 'qwerty-123', c3: 'mail.example.com' } },
    { id: 'r2', cells: { c1: 'Банк', c2: 'pin-4321' } },
  ],
};

const SAVE_WAIT = { timeout: 3000 }; // автосохранение ждёт паузу после правки

/** Последний записанный в «сейф» текст как таблица. */
function saved(): TableDoc {
  const call = mocks.saveTableText.mock.calls.at(-1);
  if (call === undefined) throw new Error('таблица не сохранялась');
  return parseTable(call[1] as string);
}

const valuesOf = (doc: TableDoc, columnId: string) => doc.rows.map((r) => r.cells[columnId] ?? '');

function cell(row: string, column: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`td[data-cell="${row}:${column}"]`);
  if (el === null) throw new Error(`нет ячейки ${row}:${column}`);
  return el;
}

async function renderTable(props: { onClose?: () => void; onSaved?: () => void } = {}) {
  const onClose = props.onClose ?? vi.fn();
  const view = render(
    <ToastProvider>
      <TableView entry={entry} onClose={onClose} onSaved={props.onSaved} />
    </ToastProvider>,
  );
  await screen.findByRole('grid', { name: 'Таблица' });
  return { ...view, onClose, user: userEvent.setup() };
}

beforeEach(() => {
  mocks.loadTable.mockResolvedValue({
    entry,
    doc: initial,
    base: { text: serializeTable(initial), modifiedAt: 100 },
  });
  mocks.saveTableText.mockImplementation(async (_id: number, text: string) => ({
    base: { text, modifiedAt: 200 },
    entry: { ...entry, modifiedAt: 200, size: text.length },
  }));
  mocks.copyText.mockResolvedValue(true);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('показ', () => {
  it('имя без расширения, столбцы и строки; секреты скрыты точками', async () => {
    await renderTable();
    expect(screen.getByRole('heading', { name: /Пароли$/ })).toBeInTheDocument();
    expect(screen.getByText('Почта')).toBeInTheDocument();
    expect(screen.getByText('mail.example.com')).toBeInTheDocument();
    expect(screen.queryByText('qwerty-123')).not.toBeInTheDocument();
    expect(screen.getAllByLabelText('Скрыто')).toHaveLength(2);
    expect(screen.getByText('2 строки')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Сохранено');
  });

  it('«Показать секреты» открывает все, 👁 в ячейке - одну', async () => {
    const { user } = await renderTable();
    await user.click(within(cell('r2', 'c2')).getByRole('button', { name: 'Показать: Пароль' }));
    expect(screen.getByText('pin-4321')).toBeInTheDocument();
    expect(screen.queryByText('qwerty-123')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Показать секреты/ }));
    expect(screen.getByText('qwerty-123')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Скрыть секреты/ }));
    expect(screen.queryByText('qwerty-123')).not.toBeInTheDocument();
    expect(screen.getByText('pin-4321')).toBeInTheDocument(); // открытая вручную остаётся
  });

  it('поиск отбирает строки и не ищет по секретным столбцам', async () => {
    const { user } = await renderTable();
    const search = screen.getByRole('searchbox', { name: 'Поиск в таблице' });
    await user.type(search, 'банк');
    expect(screen.queryByText('Почта')).not.toBeInTheDocument();
    expect(screen.getByText('Найдено: 1 из 2')).toBeInTheDocument();

    await user.clear(search);
    await user.type(search, 'qwerty');
    expect(screen.getByText('Найдено: 0 из 2')).toBeInTheDocument();
    expect(mocks.saveTableText).not.toHaveBeenCalled(); // поиск в файл не попадает
  });

  it('клик по заголовку сортирует вид, файл не меняется', async () => {
    const { user } = await renderTable();
    await user.click(screen.getByRole('button', { name: /^Сервис/ }));
    const names = () =>
      [...document.querySelectorAll('td[data-cell$=":c1"] span[title]')].map((el) => el.textContent);
    expect(names()).toEqual(['Банк', 'Почта']);
    await user.click(screen.getByRole('button', { name: /^Сервис/ }));
    expect(names()).toEqual(['Почта', 'Банк']);
    expect(mocks.saveTableText).not.toHaveBeenCalled();
  });

  it('таблица не прочиталась - сообщение, «Повторить» и «Скачать файл»', async () => {
    mocks.loadTable.mockRejectedValueOnce(new Error('Файл повреждён: это не таблица SafeBox'));
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <TableView entry={entry} onClose={vi.fn()} />
      </ToastProvider>,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Файл повреждён');
    await user.click(screen.getByRole('button', { name: 'Скачать файл' }));
    expect(mocks.triggerDownload).toHaveBeenCalledWith('/api/v1/media/7/download');
    await user.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByRole('grid', { name: 'Таблица' })).toBeInTheDocument();
  });
});

describe('правка', () => {
  it('двойной клик, ввод, Enter - значение в сейфе, статус «Сохранено»', async () => {
    const onSaved = vi.fn();
    const { user } = await renderTable({ onSaved });
    await user.dblClick(cell('r1', 'c1'));
    const editor = screen.getByRole('textbox', { name: 'Сервис: значение' });
    await user.clear(editor);
    await user.type(editor, 'Gmail{Enter}');

    expect(screen.getByText('Gmail')).toBeInTheDocument();
    expect(screen.getByRole('status')).not.toHaveTextContent('Сохранено');
    await waitFor(() => expect(mocks.saveTableText).toHaveBeenCalled(), SAVE_WAIT);
    expect(valuesOf(saved(), 'c1')).toEqual(['Gmail', 'Банк']);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Сохранено'));
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 7, modifiedAt: 200 }));
    // Enter увёл курсор на строку ниже
    expect(cell('r2', 'c1')).toHaveAttribute('aria-selected', 'true');
  });

  it('набор текста на ячейке начинает правку; Esc её отменяет и экран не закрывает', async () => {
    const { user, onClose } = await renderTable();
    await user.click(cell('r2', 'c1'));
    await user.keyboard('С');
    const editor = screen.getByRole('textbox', { name: 'Сервис: значение' });
    expect(editor).toHaveValue('С');
    await user.keyboard('бер{Escape}');
    expect(screen.queryByRole('textbox', { name: 'Сервис: значение' })).not.toBeInTheDocument();
    expect(screen.getByText('Банк')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('«+ Строка»: ввод в заготовку создаёт строку, Tab ведёт по её столбцам', async () => {
    const { user } = await renderTable();
    await user.click(screen.getByRole('button', { name: '+ Строка' }));
    await user.type(await screen.findByRole('textbox', { name: 'Сервис: значение' }), 'Форум{Tab}');
    await user.keyboard('тайна{Enter}');

    await waitFor(() => expect(mocks.saveTableText).toHaveBeenCalled(), SAVE_WAIT);
    const doc = saved();
    expect(valuesOf(doc, 'c1')).toEqual(['Почта', 'Банк', 'Форум']);
    expect(valuesOf(doc, 'c2')).toEqual(['qwerty-123', 'pin-4321', 'тайна']);
    expect(screen.getByText('3 строки')).toBeInTheDocument();
  });

  it('Delete очищает ячейку, Ctrl+Z возвращает, Ctrl+Y повторяет', async () => {
    const { user } = await renderTable();
    await user.click(cell('r1', 'c1'));
    await user.keyboard('{Delete}');
    expect(screen.queryByText('Почта')).not.toBeInTheDocument();
    await user.keyboard('{Control>}z{/Control}');
    expect(screen.getByText('Почта')).toBeInTheDocument();
    await user.keyboard('{Control>}y{/Control}');
    expect(screen.queryByText('Почта')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Отменить правку' }));
    expect(screen.getByText('Почта')).toBeInTheDocument();
    // вернулись к сохранённому: писать нечего
    expect(screen.getByRole('status')).toHaveTextContent('Сохранено');
  });

  it('вставка блока из Excel ложится по ячейкам и добавляет строки', async () => {
    const { user } = await renderTable();
    await user.click(cell('r2', 'c1'));
    fireEvent.paste(screen.getByRole('grid', { name: 'Таблица' }), {
      clipboardData: { getData: () => 'Сбер\tпароль1\nВТБ\tпароль2\n' },
    });

    await waitFor(() => expect(mocks.saveTableText).toHaveBeenCalled(), SAVE_WAIT);
    const doc = saved();
    expect(valuesOf(doc, 'c1')).toEqual(['Почта', 'Сбер', 'ВТБ']);
    expect(valuesOf(doc, 'c2')).toEqual(['qwerty-123', 'пароль1', 'пароль2']);
  });

  it('строка удаляется крестиком у номера', async () => {
    const { user } = await renderTable();
    await user.click(screen.getByRole('button', { name: 'Удалить строку 1' }));
    expect(screen.queryByText('Почта')).not.toBeInTheDocument();
    expect(screen.getByText(/Строка удалена/)).toBeInTheDocument();
    await waitFor(() => expect(mocks.saveTableText).toHaveBeenCalled(), SAVE_WAIT);
    expect(valuesOf(saved(), 'c1')).toEqual(['Банк']);
  });

  it('столбцы: добавить с названием, сменить тип, удалить', async () => {
    const { user } = await renderTable();
    await user.click(screen.getByRole('button', { name: 'Добавить столбец' }));
    const name = screen.getByRole('textbox', { name: 'Название столбца' });
    await user.clear(name);
    await user.type(name, 'Заметка{Enter}');

    await user.click(screen.getByRole('button', { name: 'Столбец «Сервис»: действия' }));
    await user.click(screen.getByRole('menuitemradio', { name: /Секрет/ }));
    expect(screen.queryByText('Почта')).not.toBeInTheDocument(); // стал секретным - скрыт

    await user.click(screen.getByRole('button', { name: 'Столбец «Сайт»: действия' }));
    await user.click(screen.getByRole('menuitem', { name: 'Удалить столбец' }));

    await waitFor(() => expect(valuesOf(saved(), 'c3')).toEqual(['', '']), SAVE_WAIT);
    expect(saved().columns.map((c) => [c.name, c.type])).toEqual([
      ['Сервис', 'secret'],
      ['Пароль', 'secret'],
      ['Заметка', 'text'],
    ]);
  });

  it('«Добавить строки из CSV»: столбцы сопоставляются по названиям', async () => {
    const { user } = await renderTable();
    const csv = new File(['Сервис;Пароль;Логин\nФорум;abc;ivan\n'], 'пароли.csv', { type: 'text/csv' });
    await user.upload(screen.getByLabelText('Файл CSV'), csv);

    await waitFor(() => expect(mocks.saveTableText).toHaveBeenCalled(), SAVE_WAIT);
    const doc = saved();
    expect(doc.columns.map((c) => c.name)).toEqual(['Сервис', 'Пароль', 'Сайт', 'Логин']);
    expect(valuesOf(doc, 'c1')).toEqual(['Почта', 'Банк', 'Форум']);
    expect(await screen.findByText('Из файла добавлено: 1 строка')).toBeInTheDocument();
  });
});

describe('копирование и ссылки', () => {
  it('секрет копируется, не появляясь на экране; в сообщении - только имя столбца', async () => {
    const { user } = await renderTable();
    await user.click(within(cell('r1', 'c2')).getByRole('button', { name: 'Копировать: Пароль' }));
    expect(mocks.copyText).toHaveBeenCalledWith('qwerty-123');
    expect(await screen.findByText('Скопировано: Пароль')).toBeInTheDocument();
    expect(screen.queryByText(/qwerty-123/)).not.toBeInTheDocument();
  });

  it('Ctrl+C копирует ячейку под курсором (и на русской раскладке)', async () => {
    const { user } = await renderTable();
    await user.click(cell('r2', 'c1'));
    fireEvent.keyDown(screen.getByRole('grid', { name: 'Таблица' }), { key: 'с', code: 'KeyC', ctrlKey: true });
    await waitFor(() => expect(mocks.copyText).toHaveBeenCalledWith('Банк'));
  });

  it('адрес открывается в новой вкладке только после подтверждения; без схемы - https', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const { user } = await renderTable();
    await user.click(within(cell('r1', 'c3')).getByRole('button', { name: 'Открыть: Сайт' }));
    expect(open).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', { name: 'Открыть внешнюю ссылку?' });
    expect(dialog).toHaveTextContent('https://mail.example.com');
    await user.click(within(dialog).getByRole('button', { name: 'Открыть' }));
    expect(open).toHaveBeenCalledWith('https://mail.example.com', '_blank', 'noopener,noreferrer');
  });
});

describe('сохранение и закрытие', () => {
  it('Esc дописывает несохранённое и только потом закрывает', async () => {
    const { user, onClose } = await renderTable();
    await user.click(cell('r1', 'c1'));
    await user.keyboard('{Delete}{Escape}');
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(valuesOf(saved(), 'c1')).toEqual(['', 'Банк']);
  });

  it('сохранить не удалось: «Повторить» в шапке, закрытие переспрашивает', async () => {
    mocks.saveTableText.mockRejectedValue(new Error('Сервер недоступен'));
    const { user, onClose } = await renderTable();
    await user.click(cell('r1', 'c1'));
    await user.keyboard('{Delete}');
    expect(await screen.findByText('Не сохранено: Сервер недоступен', {}, SAVE_WAIT)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Назад/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Закрыть без сохранения?' });
    expect(onClose).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Отмена' }));

    mocks.saveTableText.mockImplementation(async (_id: number, text: string) => ({
      base: { text, modifiedAt: 200 },
      entry,
    }));
    await user.click(screen.getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Сохранено'));
  });

  it('таблицу изменили в другом окне: правки не затирают чужое, пока не выбрано', async () => {
    mocks.saveTableText.mockRejectedValueOnce(new TableConflictError());
    const { user } = await renderTable();
    await user.click(cell('r1', 'c1'));
    await user.keyboard('{Delete}');
    expect(await screen.findByText(/изменили в другом окне/, {}, SAVE_WAIT)).toBeInTheDocument();
    expect(mocks.saveTableText).toHaveBeenCalledTimes(1);

    // дальнейшие правки сами не пишутся
    await user.click(cell('r2', 'c1'));
    await user.keyboard('{Delete}');
    await new Promise((r) => setTimeout(r, 900));
    expect(mocks.saveTableText).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Сохранить мою версию' }));
    await waitFor(() => expect(mocks.saveTableText).toHaveBeenCalledTimes(2));
    expect(mocks.saveTableText.mock.calls[1]![3]).toEqual({ force: true });
    expect(valuesOf(saved(), 'c1')).toEqual(['', '']);
    await waitFor(() => expect(screen.queryByText(/изменили в другом окне/)).not.toBeInTheDocument());
  });

  it('конфликт: «Загрузить из сейфа» берёт чужую версию', async () => {
    mocks.saveTableText.mockRejectedValueOnce(new TableConflictError());
    const { user } = await renderTable();
    await user.click(cell('r1', 'c1'));
    await user.keyboard('{Delete}');
    await screen.findByText(/изменили в другом окне/, {}, SAVE_WAIT);

    const theirs: TableDoc = { ...initial, rows: [{ id: 'r9', cells: { c1: 'Чужая строка' } }] };
    mocks.loadTable.mockResolvedValue({ entry, doc: theirs, base: { text: serializeTable(theirs), modifiedAt: 300 } });
    await user.click(screen.getByRole('button', { name: 'Загрузить из сейфа' }));
    expect(await screen.findByText('Чужая строка')).toBeInTheDocument();
    expect(screen.queryByText(/изменили в другом окне/)).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Сохранено');
  });

  it('«Сохранить как CSV» предупреждает, что файл не зашифрован', async () => {
    const { user } = await renderTable();
    await user.click(screen.getByRole('button', { name: 'Ещё: импорт и экспорт' }));
    await user.click(screen.getByRole('menuitem', { name: 'Сохранить как CSV…' }));
    expect(screen.getByRole('dialog', { name: 'Сохранить таблицу в CSV?' })).toHaveTextContent('не зашифрован');
  });
});
