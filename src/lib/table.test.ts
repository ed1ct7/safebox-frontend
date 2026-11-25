import { describe, expect, it } from 'vitest';
import {
  addColumn,
  addRow,
  cellOf,
  deleteColumn,
  deleteRows,
  freeColumnName,
  generatePassword,
  guessColumnType,
  importMatrix,
  isTable,
  moveColumn,
  nextSort,
  parseDelimited,
  parseTable,
  pasteBlock,
  serializeTable,
  setCell,
  TableFormatError,
  tableTitle,
  TEMPLATES,
  toCsv,
  updateColumn,
  viewRows,
} from './table';
import type { TableDoc } from './table';

const doc: TableDoc = {
  columns: [
    { id: 'c1', name: 'Сервис', type: 'text' },
    { id: 'c2', name: 'Логин', type: 'text' },
    { id: 'c3', name: 'Пароль', type: 'secret' },
  ],
  rows: [
    { id: 'r1', cells: { c1: 'Почта', c2: 'ivan@example.com', c3: 'qwerty-1' } },
    { id: 'r2', cells: { c1: 'Банк', c3: 'пин 4321' } },
    { id: 'r3', cells: { c1: 'банк 10', c2: 'ivan' } },
  ],
};

describe('файл таблицы', () => {
  it('таблица узнаётся по расширению, на экране имя без него', () => {
    expect(isTable({ kind: 'file', name: 'Пароли.sbtable' })).toBe(true);
    expect(isTable({ kind: 'file', name: 'Пароли.SBTABLE' })).toBe(true);
    expect(isTable({ kind: 'file', name: 'Пароли.txt' })).toBe(false);
    expect(isTable({ kind: 'folder', name: 'Папка.sbtable' })).toBe(false);
    expect(tableTitle('Пароли.sbtable')).toBe('Пароли');
    expect(tableTitle('заметки.txt')).toBe('заметки.txt');
  });

  it('запись и чтение возвращают ту же таблицу', () => {
    expect(parseTable(serializeTable(doc))).toEqual(doc);
  });

  it('чужой или испорченный файл не открывается пустой таблицей', () => {
    expect(() => parseTable('не json')).toThrow(TableFormatError);
    expect(() => parseTable('{"columns":[],"rows":[]}')).toThrow('не похож на таблицу');
    expect(() => parseTable('{"format":"safebox-table","version":2,"columns":[],"rows":[]}')).toThrow('более новой');
    expect(() =>
      parseTable('{"format":"safebox-table","version":1,"columns":[{"id":"c1"},{"id":"c1"}],"rows":[]}'),
    ).toThrow('столбцы');
  });

  it('незнакомый тип столбца читается как текст, значения чужих столбцов отбрасываются', () => {
    const parsed = parseTable(
      JSON.stringify({
        format: 'safebox-table',
        version: 1,
        columns: [{ id: 'c1', name: 'А', type: 'number' }],
        rows: [{ id: 'r1', cells: { c1: 'x', c9: 'лишнее', c2: 5 } }, { cells: { c1: '' } }, { id: 'r1', cells: {} }],
      }),
    );
    expect(parsed.columns).toEqual([{ id: 'c1', name: 'А', type: 'text' }]);
    expect(parsed.rows.map((r) => r.cells)).toEqual([{ c1: 'x' }, {}, {}]);
    expect(new Set(parsed.rows.map((r) => r.id)).size).toBe(3); // повторный и пустой id заменены
  });

  it('шаблон «Пароли» прячет пароль', () => {
    const passwords = TEMPLATES.find((t) => t.id === 'passwords')?.make();
    expect(passwords?.columns.map((c) => [c.name, c.type])).toEqual([
      ['Сервис', 'text'],
      ['Логин', 'text'],
      ['Пароль', 'secret'],
      ['Сайт', 'url'],
      ['Заметка', 'text'],
    ]);
  });
});

describe('правки', () => {
  it('ячейка: новое значение, пустое стирает, то же значение - та же таблица', () => {
    expect(cellOf(setCell(doc, 'r2', 'c2', 'petr').rows[1], 'c2')).toBe('petr');
    expect(setCell(doc, 'r1', 'c2', '').rows[0]?.cells).toEqual({ c1: 'Почта', c3: 'qwerty-1' });
    expect(setCell(doc, 'r1', 'c1', 'Почта')).toBe(doc);
    expect(setCell(doc, 'нет', 'c1', 'x')).toBe(doc);
  });

  it('строки: id новой не повторяет прежние, удаление по id', () => {
    const { doc: withRow, rowId } = addRow(doc, { c1: 'Новый', c9: 'чужой столбец', c2: '' });
    expect(rowId).toBe('r4');
    expect(withRow.rows.at(-1)).toEqual({ id: 'r4', cells: { c1: 'Новый' } });
    expect(deleteRows(withRow, new Set(['r1', 'r4'])).rows.map((r) => r.id)).toEqual(['r2', 'r3']);
    expect(deleteRows(doc, new Set(['нет']))).toBe(doc);
  });

  it('столбцы: добавить после указанного, переименовать, сменить тип, сдвинуть, удалить со значениями', () => {
    const { doc: wider, columnId } = addColumn(doc, 'Сайт', 'url', 'c1');
    expect(columnId).toBe('c4');
    expect(wider.columns.map((c) => c.id)).toEqual(['c1', 'c4', 'c2', 'c3']);
    expect(addColumn(doc, 'В конец').doc.columns.at(-1)?.name).toBe('В конец');
    expect(freeColumnName(doc)).toBe('Столбец 4');

    expect(updateColumn(doc, 'c2', { name: 'Почта', type: 'secret' }).columns[1]).toEqual({
      id: 'c2',
      name: 'Почта',
      type: 'secret',
    });
    expect(updateColumn(doc, 'c2', { name: 'Логин' })).toBe(doc);

    expect(moveColumn(doc, 'c3', -1).columns.map((c) => c.id)).toEqual(['c1', 'c3', 'c2']);
    expect(moveColumn(doc, 'c1', -1)).toBe(doc);
    expect(moveColumn(doc, 'c3', 1)).toBe(doc);

    const narrower = deleteColumn(doc, 'c3');
    expect(narrower.columns.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(narrower.rows.map((r) => r.cells)).toEqual([
      { c1: 'Почта', c2: 'ivan@example.com' },
      { c1: 'Банк' },
      { c1: 'банк 10', c2: 'ivan' },
    ]);
  });

  it('вставка блока: поверх видимых строк, не хватило строк - новые, лишние столбцы отбрасываются', () => {
    const order = ['r3', 'r1']; // на экране отсортировано и отфильтровано
    const { doc: pasted, clipped } = pasteBlock(doc, order, 1, 1, [
      ['a', 'b', 'лишнее'],
      ['c', 'd'],
      ['', ''],
    ]);
    expect(clipped).toBe(1);
    expect(pasted.rows.find((r) => r.id === 'r1')?.cells).toEqual({ c1: 'Почта', c2: 'a', c3: 'b' });
    expect(pasted.rows.find((r) => r.id === 'r3')?.cells).toEqual(doc.rows[2]?.cells); // выше места вставки
    expect(pasted.rows.at(-1)?.cells).toEqual({ c2: 'c', c3: 'd' });
    expect(pasted.rows).toHaveLength(4); // пустая строка блока строкой не стала
  });
});

describe('вид', () => {
  it('поиск: все слова, без учёта регистра, секретные столбцы не участвуют', () => {
    expect(viewRows(doc, 'БАНК', null).map((r) => r.id)).toEqual(['r2', 'r3']);
    expect(viewRows(doc, 'банк ivan', null).map((r) => r.id)).toEqual(['r3']);
    expect(viewRows(doc, 'qwerty', null)).toEqual([]);
    expect(viewRows(doc, '4321', null)).toEqual([]);
    expect(viewRows(doc, '  ', null)).toHaveLength(3);
  });

  it('сортировка: числа по значению, пустые внизу в обе стороны', () => {
    const numbers: TableDoc = {
      columns: [{ id: 'c1', name: 'N', type: 'text' }],
      rows: ['10', '', '9', 'б', 'А'].map((v, i) => {
        const cells: Record<string, string> = v === '' ? {} : { c1: v };
        return { id: `r${i + 1}`, cells };
      }),
    };
    const values = (dir: 'asc' | 'desc') =>
      viewRows(numbers, '', { columnId: 'c1', dir }).map((r) => cellOf(r, 'c1'));
    expect(values('asc')).toEqual(['9', '10', 'А', 'б', '']);
    expect(values('desc')).toEqual(['б', 'А', '10', '9', '']);
    expect(viewRows(numbers, '', { columnId: 'нет', dir: 'asc' }).map((r) => r.id)).toEqual(
      numbers.rows.map((r) => r.id),
    );
  });

  it('клик по заголовку: возрастание, убывание, как в файле', () => {
    const asc = nextSort(null, 'c1');
    expect(asc).toEqual({ columnId: 'c1', dir: 'asc' });
    const desc = nextSort(asc, 'c1');
    expect(desc).toEqual({ columnId: 'c1', dir: 'desc' });
    expect(nextSort(desc, 'c1')).toBeNull();
    expect(nextSort(desc, 'c2')).toEqual({ columnId: 'c2', dir: 'asc' });
  });
});

describe('CSV и буфер', () => {
  it('разделитель угадывается: табуляция, точка с запятой, запятая', () => {
    expect(parseDelimited('a\tb,c\r\n1\t2')).toEqual([
      ['a', 'b,c'],
      ['1', '2'],
    ]);
    expect(parseDelimited('a;b;c,d\n1;2;3')).toEqual([
      ['a', 'b', 'c,d'],
      ['1', '2', '3'],
    ]);
    expect(parseDelimited('\uFEFFa,b\n')).toEqual([['a', 'b']]);
    expect(parseDelimited('')).toEqual([]);
  });

  it('кавычки: разделитель, перенос строки и сама кавычка внутри поля', () => {
    expect(parseDelimited('name,note\n"Иванов, И.","строка 1\nстрока ""2"""\n')).toEqual([
      ['name', 'note'],
      ['Иванов, И.', 'строка 1\nстрока "2"'],
    ]);
    expect(parseDelimited('a,\n')).toEqual([['a', '']]);
  });

  it('экспорт читается обратно', () => {
    const tricky = setCell(setCell(doc, 'r2', 'c2', 'a, "b"\nc'), 'r3', 'c3', ' пробелы ');
    const [header, ...body] = parseDelimited(toCsv(tricky));
    expect(header).toEqual(['Сервис', 'Логин', 'Пароль']);
    expect(body).toEqual(tricky.rows.map((r) => tricky.columns.map((c) => cellOf(r, c.id))));
  });

  it('тип столбца по имени: пароли и коды - секрет', () => {
    expect(guessColumnType('Password')).toBe('secret');
    expect(guessColumnType('Пароль от почты')).toBe('secret');
    expect(guessColumnType('ПИН')).toBe('secret');
    expect(guessColumnType('url')).toBe('url');
    expect(guessColumnType('Сайт')).toBe('url');
    expect(guessColumnType('username')).toBe('text');
    expect(guessColumnType('Заметка')).toBe('text');
  });

  it('импорт в пустую таблицу берёт столбцы из файла (экспорт паролей Chrome)', () => {
    const empty = TEMPLATES[0]?.make() as TableDoc;
    const { doc: imported, added } = importMatrix(empty, [
      ['name', 'url', 'username', 'password'],
      ['Почта', 'https://mail.example.com', 'ivan', 's3cret'],
      ['', '', '', ''],
    ]);
    expect(added).toBe(1);
    expect(imported.columns.map((c) => [c.name, c.type])).toEqual([
      ['name', 'text'],
      ['url', 'url'],
      ['username', 'text'],
      ['password', 'secret'],
    ]);
    expect(imported.rows).toHaveLength(1);
  });

  it('импорт в таблицу с данными дописывает строки: столбец по имени, незнакомый - справа', () => {
    const { doc: imported, added } = importMatrix(doc, [
      ['логин', 'Сайт', ''],
      ['petr', 'https://example.com', 'x'],
    ]);
    expect(added).toBe(1);
    expect(imported.columns.map((c) => c.name)).toEqual(['Сервис', 'Логин', 'Пароль', 'Сайт', 'Столбец 3']);
    expect(imported.rows).toHaveLength(4);
    expect(imported.rows.at(-1)?.cells).toEqual({ c2: 'petr', c4: 'https://example.com', c5: 'x' });
  });
});

describe('генератор паролей', () => {
  it('нужная длина, все виды символов, без похожих знаков, каждый раз новый', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i += 1) {
      const p = generatePassword(20);
      seen.add(p);
      expect(p).toHaveLength(20);
      expect(p).toMatch(/[a-z]/);
      expect(p).toMatch(/[A-Z]/);
      expect(p).toMatch(/[2-9]/);
      expect(p).toMatch(/[!@#$%^&*\-_=+?]/);
      expect(p).not.toMatch(/[lIO01\s]/);
    }
    expect(seen.size).toBe(50);
    expect(generatePassword(1)).toHaveLength(4);
  });
});
