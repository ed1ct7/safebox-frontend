import { describe, expect, it } from 'vitest';
import { boxFromPoints, boxesIntersect } from './rubberBand';

describe('boxFromPoints', () => {
  it('протяжка вправо-вниз', () => {
    expect(boxFromPoints(10, 20, 30, 50)).toEqual({ left: 10, top: 20, width: 20, height: 30 });
  });

  it('протяжка влево-вверх - нормализуется', () => {
    expect(boxFromPoints(30, 50, 10, 20)).toEqual({ left: 10, top: 20, width: 20, height: 30 });
  });

  it('точка - нулевой размер', () => {
    expect(boxFromPoints(5, 5, 5, 5)).toEqual({ left: 5, top: 5, width: 0, height: 0 });
  });
});

describe('boxesIntersect', () => {
  const a = { left: 0, top: 0, width: 10, height: 10 };

  it('перекрытие', () => {
    expect(boxesIntersect(a, { left: 5, top: 5, width: 10, height: 10 })).toBe(true);
  });

  it('касание краём считается', () => {
    expect(boxesIntersect(a, { left: 10, top: 0, width: 5, height: 5 })).toBe(true);
  });

  it('мимо', () => {
    expect(boxesIntersect(a, { left: 11, top: 11, width: 5, height: 5 })).toBe(false);
  });

  it('внутри', () => {
    expect(boxesIntersect(a, { left: 2, top: 2, width: 3, height: 3 })).toBe(true);
  });
});
