import { beforeEach, describe, expect, it } from 'vitest';
import { forgetSafe, loadRecentSafes, rememberSafe } from './recentSafes';

beforeEach(() => localStorage.clear());

describe('recentSafes', () => {
  it('помнит сейфы, свежий - первым', () => {
    rememberSafe('C:\\a.safebox');
    rememberSafe('C:\\b.safebox');
    expect(loadRecentSafes()).toEqual(['C:\\b.safebox', 'C:\\a.safebox']);
  });

  it('дубль (без учёта регистра) не размножает записи', () => {
    rememberSafe('C:\\A.safebox');
    rememberSafe('c:\\a.safebox');
    expect(loadRecentSafes()).toEqual(['c:\\a.safebox']);
  });

  it('не больше 8 записей', () => {
    for (let i = 0; i < 12; i++) rememberSafe(`C:\\s${i}.safebox`);
    expect(loadRecentSafes()).toHaveLength(8);
    expect(loadRecentSafes()[0]).toBe('C:\\s11.safebox');
  });

  it('крестик убирает запись', () => {
    rememberSafe('C:\\a.safebox');
    rememberSafe('C:\\b.safebox');
    forgetSafe('c:\\A.SAFEBOX');
    expect(loadRecentSafes()).toEqual(['C:\\b.safebox']);
  });

  it('битое хранилище читается как пустое', () => {
    localStorage.setItem('sbx_recent_safes', '{ups');
    expect(loadRecentSafes()).toEqual([]);
  });
});
