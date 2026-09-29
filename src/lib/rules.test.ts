import { describe, expect, it } from 'vitest';
import { validateEntryName, validateNewPassword } from './rules';

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
