import { describe, expect, it } from 'vitest';
import { makeEntry } from '../test/factories';
import { decodeText, extOf, isAudio, isProse, isText } from './fileView';

describe('extOf', () => {
  it('нижний регистр без точки; нет расширения - пусто', () => {
    expect(extOf('Голос.OGA')).toBe('oga');
    expect(extOf('архив.tar.gz')).toBe('gz');
    expect(extOf('.gitignore')).toBe('gitignore');
    expect(extOf('README')).toBe('');
    expect(extOf('точка.')).toBe('');
  });
});

describe('isAudio / isText', () => {
  it('аудио - по mime или расширению, только у файлов', () => {
    expect(isAudio(makeEntry({ name: 'a.bin', mime: 'audio/mpeg' }))).toBe(true);
    for (const name of ['v.oga', 'x.FLAC', 'y.wav', 'z.m4a', 'w.aac', 'o.opus', 'm.mp3']) {
      expect(isAudio(makeEntry({ name, mime: 'application/octet-stream' }))).toBe(true);
    }
    expect(isAudio(makeEntry({ name: 'song.mid' }))).toBe(false); // браузер не играет
    expect(isAudio(makeEntry({ kind: 'video', name: 'clip.mp4', mime: 'video/mp4' }))).toBe(false);
    expect(isAudio(makeEntry({ kind: 'folder', name: 'Музыка.mp3' }))).toBe(false);
  });

  it('текст - по mime или расширению; документы Office - нет', () => {
    expect(isText(makeEntry({ name: 'x', mime: 'text/plain' }))).toBe(true);
    for (const name of ['n.md', 'a.TXT', 'c.conf', 'd.json', 'e.drawio', 's.svg', 'p.sln']) {
      expect(isText(makeEntry({ name, mime: 'application/octet-stream' }))).toBe(true);
    }
    for (const name of ['d.docx', 'p.pptx', 'a.rar', 'b.pdf', 'c.eu4']) {
      expect(isText(makeEntry({ name, mime: 'application/octet-stream' }))).toBe(false);
    }
    expect(isText(makeEntry({ kind: 'link', name: 'a.txt' }))).toBe(false);
    // плейлист с mime аудио - аудио-запись, не текст (одна запись - один вид)
    expect(isText(makeEntry({ name: 'list.m3u', mime: 'audio/x-mpegurl' }))).toBe(false);
  });

  it('проза - txt и md (обычный шрифт), код - моноширинный', () => {
    expect(isProse(makeEntry({ name: 'n.md' }))).toBe(true);
    expect(isProse(makeEntry({ name: 'c.json' }))).toBe(false);
  });
});

const bytes = (...xs: number[]) => new Uint8Array(xs);
const utf8 = (s: string) => new TextEncoder().encode(s);

describe('decodeText', () => {
  it('UTF-8, BOM снимается', () => {
    expect(decodeText(utf8('Привет'), false)).toEqual({ text: 'Привет', encoding: 'utf-8', binary: false });
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8('да')]), false).text).toBe('да');
  });

  it('обрезанный посреди символа UTF-8 - хвост отбрасывается, кодировка не меняется', () => {
    const full = utf8('ёж'); // d1 91 d0 b6
    const cut = full.subarray(0, 3);
    expect(decodeText(cut, true)).toEqual({ text: 'ё', encoding: 'utf-8', binary: false });
    // не обрезанный, но битый - это не UTF-8
    expect(decodeText(cut, false).encoding).toBe('windows-1251');
  });

  it('не UTF-8 - windows-1251', () => {
    // «Мир» в cp1251
    expect(decodeText(bytes(0xcc, 0xe8, 0xf0), false)).toEqual({
      text: 'Мир',
      encoding: 'windows-1251',
      binary: false,
    });
  });

  it('UTF-16 по BOM', () => {
    expect(decodeText(bytes(0xff, 0xfe, 0x1f, 0x04, 0x30, 0x04), false)).toEqual({
      text: 'Па',
      encoding: 'utf-16le',
      binary: false,
    });
    expect(decodeText(bytes(0xfe, 0xff, 0x04, 0x1f), false).text).toBe('П');
  });

  it('единичный битый байт не уводит UTF-8 в 1251', () => {
    const text = 'Заметка '.repeat(200); // ~1600 символов
    const broken = new Uint8Array([...utf8(text), 0xff, ...utf8(' конец')]);
    const out = decodeText(broken, false);
    expect(out.encoding).toBe('utf-8');
    expect(out.text.startsWith('Заметка Заметка')).toBe(true);
  });

  it('UTF-16 без BOM - по нулям через байт', () => {
    const le = new Uint8Array([...'Hello, world 123'].flatMap((c) => [c.charCodeAt(0), 0]));
    expect(decodeText(le, false)).toEqual({ text: 'Hello, world 123', encoding: 'utf-16le', binary: false });
    const be = new Uint8Array([...'Hello, world 123'].flatMap((c) => [0, c.charCodeAt(0)]));
    expect(decodeText(be, false).encoding).toBe('utf-16be');
  });

  it('пустой файл - пустой текст', () => {
    expect(decodeText(new Uint8Array(), false)).toEqual({ text: '', encoding: 'utf-8', binary: false });
  });

  it('нули - двоичный файл', () => {
    expect(decodeText(bytes(0x50, 0x4b, 0x00, 0x00, 0x41), false).binary).toBe(true);
  });
});
