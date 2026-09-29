import { describe, expect, it } from 'vitest';
import { EMPTY_WATCH, fpOf, processPoll, skipWatchName } from './watch';
import type { WatchFile, WatchState } from './watch';

const f = (name: string, size: number, mtime: number): WatchFile => ({ name, size, mtime });

function stateOf(known: string[] = [], baselineDone = true): WatchState {
  return { known: new Set(known), sightings: new Map(), baselineDone };
}

describe('skipWatchName', () => {
  it('недогруженные и служебные файлы пропускаются', () => {
    expect(skipWatchName('movie.mp4.crdownload')).toBe(true);
    expect(skipWatchName('setup.exe.part')).toBe(true);
    expect(skipWatchName('data.tmp')).toBe(true);
    expect(skipWatchName('desktop.ini')).toBe(true);
    expect(skipWatchName('Thumbs.db')).toBe(true);
    expect(skipWatchName('foto.jpg')).toBe(false);
  });
});

describe('fpOf', () => {
  it('не раскрывает имя файла и различает версии', () => {
    const a = f('секретный договор.pdf', 100, 1);
    expect(fpOf(a)).not.toContain('договор');
    expect(fpOf(a)).toBe(fpOf({ ...a }));
    expect(fpOf(a)).not.toBe(fpOf({ ...a, size: 101 }));
    expect(fpOf(a)).not.toBe(fpOf({ ...a, mtime: 2 }));
  });
});

describe('processPoll', () => {
  it('первый опрос помечает существующие файлы без импорта (baseline)', () => {
    const files = [f('старое.jpg', 10, 1), f('книга.pdf', 100, 2)];
    const r1 = processPoll(files, EMPTY_WATCH);
    expect(r1.toImport).toEqual([]);
    const r2 = processPoll(files, r1.state);
    expect(r2.toImport).toEqual([]); // baseline ещё не был пройден на момент опроса
    const r3 = processPoll(files, r2.state);
    expect(r3.toImport).toEqual([]); // уже известны
  });

  it('новый файл импортируется после двух стабильных опросов', () => {
    const a = f('a.jpg', 10, 1);
    let st = stateOf([fpOf(a)]);
    const b = f('b.jpg', 20, 2);
    st = processPoll([a, b], st).state; // первое наблюдение b
    const r = processPoll([a, b], st);
    expect(r.toImport.map((x) => x.name)).toEqual(['b.jpg']);
    // повторный опрос — не дублирует
    expect(processPoll([a, b], r.state).toImport).toEqual([]);
  });

  it('растущий файл (скачивание) не импортируется, пока не стабилизируется', () => {
    const a = f('a.jpg', 10, 1);
    let st = stateOf([fpOf(a)]);
    const growing = (size: number) => [a, f('video.mp4', size, 100)] as const;
    st = processPoll([...growing(1000)], st).state;
    st = processPoll([...growing(5000)], st).state; // размер изменился — счётчик сбросился
    st = processPoll([...growing(9000)], st).state;
    const r = processPoll([...growing(9000)], st); // два раза одинаковый размер
    expect(r.toImport.map((x) => x.name)).toEqual(['video.mp4']);
    expect(r.toImport[0]!.size).toBe(9000);
  });

  it('изменённый файл (новая версия) — это новый отпечаток', () => {
    const old = f('заметка.txt', 5, 1);
    let st = processPoll([old], EMPTY_WATCH).state;
    st = processPoll([old], st).state;
    const next = f('заметка.txt', 9, 2);
    st = processPoll([next], st).state;
    const r = processPoll([next], st);
    expect(r.toImport.map((x) => x.size)).toEqual([9]);
  });

  it('пропущенные имена не мешают остальным', () => {
    const a = f('x.download', 1, 1);
    const b = f('ок.txt', 2, 2);
    let st = stateOf();
    st = processPoll([a, b], st).state;
    const r = processPoll([a, b], st);
    expect(r.toImport.map((x) => x.name)).toEqual(['ок.txt']);
    expect(r.state.known.has(fpOf(a))).toBe(false);
  });
});
