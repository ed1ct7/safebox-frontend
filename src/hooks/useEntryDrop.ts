import { useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { dragKind } from '../lib/dnd';
import { isTypingTarget } from '../lib/dom';

/**
 * Приёмник перетаскиваемых карточек (UF-14) и, если задан onDropLink, ссылок из
 * браузера (UF-20): подсветка при наведении, drop. canDrop зовётся на каждый
 * dragover - должен быть дешёвым. Чужие перетаскивания (файлы из проводника)
 * не трогаем: событие идёт дальше, к импорту.
 */
export function useEntryDrop(
  canDrop: () => boolean,
  onDrop: () => void,
  onDropLink?: (dt: DataTransfer) => void,
) {
  const [over, setOver] = useState(false);
  const depth = useRef(0); // dragenter/leave срабатывают и на потомках

  // карточки - если можно бросить именно сюда; ссылку берёт любой приёмник со своим onDropLink
  const kindOf = (e: DragEvent) => {
    const kind = dragKind(e.dataTransfer.types);
    // текст, брошенный в поле ввода (переименование), - не ссылка
    return kind === 'link' && (onDropLink === undefined || isTypingTarget(e.target)) ? null : kind;
  };
  const accepts = (e: DragEvent) => {
    const kind = kindOf(e);
    return kind === 'link' || (kind === 'entries' && canDrop());
  };

  return {
    over,
    props: {
      onDragEnter: (e: DragEvent) => {
        if (!accepts(e)) return;
        e.stopPropagation();
        depth.current += 1;
        setOver(true);
      },
      onDragOver: (e: DragEvent) => {
        if (!accepts(e)) return;
        e.preventDefault();
        e.stopPropagation();
        if (kindOf(e) === 'entries') e.dataTransfer.dropEffect = 'move';
      },
      onDragLeave: (e: DragEvent) => {
        const kind = kindOf(e);
        if (kind !== 'entries' && kind !== 'link') return;
        // окно считает вход/выход по своим приёмникам: чужой выход ему не нужен
        if (kind === 'link') e.stopPropagation();
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setOver(false);
      },
      onDrop: (e: DragEvent) => {
        depth.current = 0;
        setOver(false);
        if (!accepts(e)) return;
        e.preventDefault();
        e.stopPropagation();
        if (kindOf(e) === 'link') onDropLink?.(e.dataTransfer);
        else onDrop();
      },
    },
  };
}
