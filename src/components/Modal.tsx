import { useEffect, useRef } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { useEscape } from '../hooks/useDismiss';

// Сколько модалок открыто: глобальные хоткеи галереи (Delete, F2, Ctrl+A,
// вставка) молчат, пока пользователь в диалоге или просмотрщике.
let openModals = 0;

export function anyModalOpen(): boolean {
  return openModals > 0;
}

/**
 * Оверлей: Escape и клик мимо закрывают. «Мимо» — элемент с data-dismiss
 * (сам фон или, например, сцена лайтбокса вокруг фото), причём и нажатие,
 * и отпускание кнопки мыши должны прийти на него: выделение текста в поле
 * с отпусканием за пределами окна диалог не закрывает.
 */
export function Modal({
  onClose,
  children,
  className = 'flex items-center justify-center bg-black/70 p-4',
  label,
}: {
  onClose: () => void;
  children: ReactNode;
  className?: string;
  label?: string;
}) {
  const downTarget = useRef<EventTarget | null>(null);
  useEscape(onClose);

  useEffect(() => {
    openModals += 1;
    return () => {
      openModals -= 1;
    };
  }, []);

  const isDismissArea = (t: EventTarget | null) =>
    t instanceof HTMLElement && t.dataset.dismiss !== undefined;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={label}
      data-dismiss=""
      className={`fixed inset-0 z-50 ${className}`}
      onMouseDown={(e: MouseEvent) => {
        downTarget.current = e.target;
      }}
      onClick={(e: MouseEvent) => {
        if (e.target === downTarget.current && isDismissArea(e.target)) onClose();
        downTarget.current = null;
      }}
    >
      {children}
    </div>
  );
}

/** Карточка диалога на тёмном фоне. wide - для диалогов со списками. */
export function DialogPanel({
  title,
  children,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className={`w-full rounded-xl border border-zinc-700 bg-zinc-900 p-5 shadow-2xl ${
        wide ? 'max-w-2xl' : 'max-w-md'
      }`}
    >
      <h3 className="text-base font-medium text-zinc-100">{title}</h3>
      {children}
    </div>
  );
}
