import { useEffect, useRef } from 'react';
import { useEvent } from './useEvent';

/**
 * Escape закрывает верхний слой. Слушаем document и останавливаем всплытие —
 * глобальные хоткеи окна (на window) того же нажатия уже не увидят: сначала
 * закрывается модалка/меню, и только следующий Escape снимет выделение.
 * enabled=false обязателен для закрытых меню: иначе они глотали бы каждый Escape.
 */
export function useEscape(onEscape: () => void, enabled = true): void {
  const stable = useEvent(onEscape);
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      stable();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [stable, enabled]);
}

/** Закрытие меню/поповера: клик мимо или Escape (только пока открыто). */
export function useDismiss<T extends HTMLElement>(onClose: () => void, enabled = true) {
  const ref = useRef<T>(null);
  const stable = useEvent(onClose);
  useEscape(onClose, enabled);
  useEffect(() => {
    if (!enabled) return;
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current !== null && !ref.current.contains(e.target as Node)) stable();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [stable, enabled]);
  return ref;
}
