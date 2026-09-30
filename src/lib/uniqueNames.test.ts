import { describe, expect, it } from 'vitest';
import { planSuffixRename, withSuffix } from './uniqueNames';

describe('withSuffix', () => {
  it('приписка перед расширением', () => {
    expect(withSuffix('кот.jpg', 2)).toBe('кот (2).jpg');
    expect(withSuffix('отчёт.final.pdf', 3)).toBe('отчёт.final (3).pdf');
  });

  it('без расширения и скрытые файлы', () => {
    expect(withSuffix('заметки', 2)).toBe('заметки (2)');
    expect(withSuffix('.gitignore', 2)).toBe('.gitignore (2)'); // точка в начале - не расширение
  });
});

describe('planSuffixRename', () => {
  const e = (id: number, name: string, parentId: number | null = null) => ({ id, name, parentId });

  it('первый в группе сохраняет имя, остальные получают (2), (3)', () => {
    const changes = planSuffixRename([e(1, 'dup.jpg'), e(2, 'dup.jpg'), e(3, 'dup.jpg'), e(4, 'другой.txt')]);
    expect(changes).toEqual([
      { id: 2, from: 'dup.jpg', to: 'dup (2).jpg' },
      { id: 3, from: 'dup.jpg', to: 'dup (3).jpg' },
    ]);
  });

  it('одинаковые имена в РАЗНЫХ папках не конфликтуют - план пуст', () => {
    const changes = planSuffixRename([e(1, 'IMG.jpg', 10), e(2, 'IMG.jpg', 20)]);
    expect(changes).toEqual([]);
  });

  it('группа без учёта регистра и «ё»=«е» - но в одной папке', () => {
    const changes = planSuffixRename([e(1, 'Ёж.jpg', 5), e(2, 'еж.JPG', 5)]);
    expect(changes).toEqual([{ id: 2, from: 'еж.JPG', to: 'еж (2).JPG' }]);
  });

  it('свободная приписка считается по соседям той же папки', () => {
    const changes = planSuffixRename(
      [e(1, 'dup.jpg', 5), e(2, 'dup.jpg', 5)],
      [e(1, 'dup.jpg', 5), e(2, 'dup.jpg', 5), e(9, 'dup (2).jpg', 5), e(8, 'dup (2).jpg', 77)],
    );
    expect(changes).toEqual([{ id: 2, from: 'dup.jpg', to: 'dup (3).jpg' }]);
  });

  it('несколько независимых групп в одной папке', () => {
    const changes = planSuffixRename([e(1, 'a.jpg'), e(2, 'b.png'), e(3, 'a.jpg'), e(4, 'b.png')]);
    expect(changes.map((c) => c.to)).toEqual(['a (2).jpg', 'b (2).png']);
  });

  it('без дублей - пустой план', () => {
    expect(planSuffixRename([e(1, 'a.jpg'), e(2, 'b.jpg')])).toEqual([]);
  });
});
