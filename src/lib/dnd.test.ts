import { describe, expect, it } from 'vitest';
import { pastedFile } from './dnd';

describe('pastedFile (Ctrl+V картинки из браузера)', () => {
  it('безликое image.png получает имя с датой', () => {
    const src = new File([new Uint8Array([1, 2, 3])], 'image.png', { type: 'image/png' });
    const out = pastedFile(src);
    expect(out.name).toMatch(/^Вставлено \d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}\.png$/);
    expect(out.type).toBe('image/png');
  });

  it('jpeg → jpg, содержимое сохраняется', async () => {
    const src = new File([new Uint8Array([9, 9])], 'image.jpeg', { type: 'image/jpeg' });
    const out = pastedFile(src);
    expect(out.name.endsWith('.jpg')).toBe(true);
    expect(out.size).toBe(2);
  });

  it('именной файл не переименовывается', () => {
    const src = new File([new Uint8Array([1])], 'отчёт.png', { type: 'image/png' });
    expect(pastedFile(src).name).toBe('отчёт.png');
  });

  it('не-картинка не переименовывается', () => {
    const src = new File([new Uint8Array([1])], 'unknown', { type: 'text/plain' });
    expect(pastedFile(src).name).toBe('unknown');
  });
});
