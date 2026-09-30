// Геометрия рамки выделения (UF-9, «как в проводнике»): чистые функции без React.

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Прямоугольник по двум точкам: направление протяжки может быть любым. */
export function boxFromPoints(x0: number, y0: number, x1: number, y1: number): Box {
  return {
    left: Math.min(x0, x1),
    top: Math.min(y0, y1),
    width: Math.abs(x1 - x0),
    height: Math.abs(y1 - y0),
  };
}

/** Пересекаются ли прямоугольники; касание краём тоже считается. */
export function boxesIntersect(a: Box, b: Box): boolean {
  return (
    a.left <= b.left + b.width &&
    b.left <= a.left + a.width &&
    a.top <= b.top + b.height &&
    b.top <= a.top + a.height
  );
}
