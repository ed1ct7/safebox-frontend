import { describe, expect, it } from 'vitest';
import {
  MAX_DESCRIPTION_BYTES,
  validateDescription,
  validateEntryName,
  validateLinkUrl,
  validateNewPassword,
  validateTagName,
} from './rules';

describe('validateTagName', () => {
  it('зеркалит правила сервера: не пусто, до 100 символов, без «:» и управляющих', () => {
    expect(validateTagName('eris greyrat')).toBeNull();
    expect(validateTagName('  ru  ')).toBeNull();
    expect(validateTagName('   ')).toBe('Имя тега не может быть пустым');
    expect(validateTagName('')).toBe('Имя тега не может быть пустым');
    expect(validateTagName('a:b')).toBe('Символ «:» в имени тега запрещён');
    expect(validateTagName('a\u0007b')).toMatch(/Управляющие/);
    expect(validateTagName('д'.repeat(100))).toBeNull();
    expect(validateTagName('д'.repeat(101))).toMatch(/длиннее 100/);
  });

  it('длина считается в символах, а не в кодовых единицах', () => {
    expect(validateTagName('😀'.repeat(100))).toBeNull();
    expect(validateTagName('😀'.repeat(101))).not.toBeNull();
  });

  it('сообщение называет, что проверяется: тег или категория', () => {
    expect(validateTagName(' ', 'категории')).toBe('Имя категории не может быть пустым');
    expect(validateTagName('a:b', 'категории')).toBe('Символ «:» в имени категории запрещён');
  });
});

describe('validateEntryName', () => {
  it('зеркалит правила сервера PATCH /entries/:id', () => {
    expect(validateEntryName('Фото 2024.jpg')).toBeNull();
    expect(validateEntryName('  ')).toBe('Имя не может быть пустым');
    expect(validateEntryName('.')).not.toBeNull();
    expect(validateEntryName('..')).not.toBeNull();
    expect(validateEntryName('a/b')).not.toBeNull();
    expect(validateEntryName('a\\b')).not.toBeNull();
    expect(validateEntryName('a:b')).not.toBeNull();
    expect(validateEntryName('a*b?c"d<e>f|g')).not.toBeNull();
    expect(validateEntryName('a\u0001b')).not.toBeNull();
    expect(validateEntryName('д'.repeat(128))).not.toBeNull(); // 256 байт UTF-8 > 255
    expect(validateEntryName('д'.repeat(127))).toBeNull(); // 254 байта — ок
  });
});

describe('validateNewPassword', () => {
  it('минимум 6 символов и совпадение', () => {
    expect(validateNewPassword('12345', '12345')).toMatch(/минимум 6/);
    expect(validateNewPassword('123456', '123457')).toBe('Пароли не совпадают');
    expect(validateNewPassword('123456', '123456')).toBeNull();
  });
});

describe('validateDescription', () => {
  it('пустое и обычное описание допустимы', () => {
    expect(validateDescription('')).toBeNull();
    expect(validateDescription('Строка 1\nСтрока 2')).toBeNull();
  });

  it('предел - 64 КиБ в UTF-8, а не 64 Ki символов', () => {
    expect(validateDescription('a'.repeat(MAX_DESCRIPTION_BYTES))).toBeNull();
    expect(validateDescription('a'.repeat(MAX_DESCRIPTION_BYTES + 1))).not.toBeNull();
    expect(validateDescription('д'.repeat(MAX_DESCRIPTION_BYTES / 2))).toBeNull();
    expect(validateDescription('д'.repeat(MAX_DESCRIPTION_BYTES / 2 + 1))).not.toBeNull();
  });
});

describe('validateLinkUrl', () => {
  it('только http и https', () => {
    expect(validateLinkUrl('https://example.com/a?b=1')).toBeNull();
    expect(validateLinkUrl('http://localhost:5173')).toBeNull();
    expect(validateLinkUrl('ftp://example.com')).not.toBeNull();
    expect(validateLinkUrl('example.com')).not.toBeNull();
    expect(validateLinkUrl('')).not.toBeNull();
  });
});
