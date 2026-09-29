import { describe, expect, it } from 'vitest';
import type { PendingFile } from '../api/endpoints';
import { applyResolutions, buildManifest, pathOf, planFiles } from './importPlan';
import type { Resolutions } from './importPlan';

function file(name: string, opts: { path?: string; size?: number; modified?: number } = {}): PendingFile {
  const f = new File(['x'.repeat(opts.size ?? 3)], name, { lastModified: opts.modified ?? 1000 }) as PendingFile;
  if (opts.path !== undefined) f.relativePath = opts.path;
  return f;
}

describe('pathOf / planFiles', () => {
  it('путь - относительный, а без него имя файла', () => {
    expect(pathOf(file('a.txt'))).toBe('a.txt');
    expect(pathOf(file('a.txt', { path: 'Папка/Под/a.txt' }))).toBe('Папка/Под/a.txt');
  });

  it('план - пути и размеры, без содержимого', () => {
    expect(planFiles([file('a.txt', { size: 5 }), file('b.jpg', { path: 'P/b.jpg', size: 7 })])).toEqual([
      { path: 'a.txt', size: 5 },
      { path: 'P/b.jpg', size: 7 },
    ]);
  });
});

describe('applyResolutions', () => {
  const files = [file('a.txt'), file('b.txt'), file('c.txt', { path: 'P/c.txt' })];

  it('без решений уходят все файлы', () => {
    const r = applyResolutions(files, new Map());
    expect(r.send).toEqual(files);
    expect(r.skipped).toBe(0);
  });

  it('пропущенные не передаются вовсе, остальные (в том числе replace/keepBoth) - да', () => {
    const resolutions: Resolutions = new Map([
      ['a.txt', 'skip'],
      ['b.txt', 'replace'],
      ['P/c.txt', 'keepBoth'],
    ]);
    const r = applyResolutions(files, resolutions);
    expect(r.send.map(pathOf)).toEqual(['b.txt', 'P/c.txt']);
    expect(r.skipped).toBe(1);
  });

  it('решение действует на все файлы с этим путём', () => {
    const twins = [file('a.txt'), file('a.txt')];
    const r = applyResolutions(twins, new Map([['a.txt', 'skip']]));
    expect(r.send).toEqual([]);
    expect(r.skipped).toBe(2);
  });
});

describe('buildManifest', () => {
  it('lastModified есть у каждого файла, onConflict - только у решённых', () => {
    const files = [
      file('a.txt', { modified: 111 }),
      file('b.txt', { path: 'P/b.txt', modified: 222 }),
      file('c.txt', { modified: 333 }),
    ];
    const resolutions: Resolutions = new Map([
      ['a.txt', 'replace'],
      ['P/b.txt', 'keepBoth'],
    ]);
    expect(buildManifest(files, resolutions)).toEqual({
      files: {
        'a.txt': { lastModified: 111, onConflict: 'replace' },
        'P/b.txt': { lastModified: 222, onConflict: 'keepBoth' },
        'c.txt': { lastModified: 333 },
      },
    });
  });

  it('путь «__proto__» остаётся обычным ключом', () => {
    const manifest = buildManifest([file('__proto__', { modified: 5 })], new Map());
    expect(JSON.parse(JSON.stringify(manifest))).toEqual({ files: { ['__proto__']: { lastModified: 5 } } });
    expect(Object.keys(manifest.files)).toEqual(['__proto__']);
  });
});
