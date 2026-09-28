import { useCallback, useEffect, useRef, useState } from 'react';
import { heartbeat } from '../api/endpoints';

export const HEARTBEAT_INTERVAL_MS = 20_000;

/**
 * Присутствие (docs/api.md §5): каждые 20 с уходит {active}. Активность —
 * мышь/клавиатура/навигация + длинные действия (импорт, воспроизведение),
 * которые отмечают флаг сами через activityRef/refresh.
 */
export function useHeartbeat(): {
  activityRef: React.MutableRefObject<boolean>;
  idleRemainingSec: number | null;
  refresh: () => void;
} {
  const activityRef = useRef(true);
  const [idleRemainingSec, setIdleRemainingSec] = useState<number | null>(null);
  const inFlight = useRef(false);

  const tick = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const r = await heartbeat(activityRef.current);
      activityRef.current = false;
      setIdleRemainingSec(r.idleRemainingSec);
    } catch {
      // 401 уже превратился в экран входа; сетевая ошибка — попробуем в след. тик
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    void tick();
    const iv = setInterval(() => void tick(), HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(iv);
  }, [tick]);

  useEffect(() => {
    const mark = () => {
      activityRef.current = true;
    };
    const events = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const;
    for (const type of events) window.addEventListener(type, mark, { passive: true });
    const onVisibility = () => {
      if (document.visibilityState === 'visible') mark();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      for (const type of events) window.removeEventListener(type, mark);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  const refresh = useCallback(() => {
    activityRef.current = true;
    void tick();
  }, [tick]);

  return { activityRef, idleRemainingSec, refresh };
}

/** Отметить активность из длинных действий (импорт, видео, лайтбокс). */
export function markActivity(activityRef: React.MutableRefObject<boolean>): void {
  activityRef.current = true;
}
