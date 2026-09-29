import { describe, expect, it } from 'vitest';
import { foldForSearch } from './fold';

describe('foldForSearch', () => {
  it('регистр не важен', () => {
    expect(foldForSearch('Eris GREYRAT')).toBe('eris greyrat');
    expect(foldForSearch('РУССКИЙ')).toBe('русский');
  });

  it('«ё» = «е», в том числе заглавная и составная', () => {
    expect(foldForSearch('Ёлка')).toBe('елка');
    expect(foldForSearch('ёж')).toBe('еж');
    expect(foldForSearch('ёлка')).toBe('елка'); // «е» + диакритика склеивается в «ё»
  });

  it('остальные символы и пробелы не трогает', () => {
    expect(foldForSearch(' a-b_c ')).toBe(' a-b_c ');
    expect(foldForSearch('')).toBe('');
  });
});
