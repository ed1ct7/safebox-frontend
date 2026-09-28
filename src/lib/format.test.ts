import { describe, expect, it } from 'vitest';
import { formatBytes, formatDateTime, plural } from './format';

describe('formatBytes', () => {
  it('байты без дробей', () => {
    expect(formatBytes(0)).toBe('0 Б');
    expect(formatBytes(512)).toBe('512 Б');
    expect(formatBytes(1023)).toBe('1023 Б');
  });

  it('килобайты и мегабайты с одной цифрой после точки', () => {
    expect(formatBytes(1024)).toBe('1.0 КБ');
    expect(formatBytes(1536)).toBe('1.5 КБ');
    expect(formatBytes(8 * 1024 * 1024)).toBe('8.0 МБ');
  });

  it('крупные значения округляются', () => {
    expect(formatBytes(123 * 1024 * 1024)).toBe('123 МБ');
  });

  it('гигабайты и терабайты', () => {
    expect(formatBytes(1.5 * 1024 ** 3)).toBe('1.5 ГБ');
    expect(formatBytes(2 * 1024 ** 4)).toBe('2.0 ТБ');
  });
});

describe('formatDateTime', () => {
  it('дд.ММ.гггг чч:мм из локального времени', () => {
    const ms = new Date(2024, 0, 2, 9, 5).getTime();
    expect(formatDateTime(ms)).toBe('02.01.2024 09:05');
  });
});

describe('plural', () => {
  it('русские формы', () => {
    expect(plural(1, 'объект', 'объекта', 'объектов')).toBe('1 объект');
    expect(plural(2, 'объект', 'объекта', 'объектов')).toBe('2 объекта');
    expect(plural(5, 'объект', 'объекта', 'объектов')).toBe('5 объектов');
    expect(plural(11, 'объект', 'объекта', 'объектов')).toBe('11 объектов');
    expect(plural(21, 'объект', 'объекта', 'объектов')).toBe('21 объект');
  });
});
