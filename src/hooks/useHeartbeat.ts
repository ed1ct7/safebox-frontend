import { useCallback, useEffect, useRef, useState } from 'react';
import { heartbeat } from '../api/endpoints';

export const HEARTBEAT_INTERVAL_MS = 20_000;
/** UF-13 (SHOULD): предупреждение за минуту до автоблокировки. */
export const IDLE_WARNING_SEC = 60;
// пока предупреждение на экране, активность сообщаем сразу — но не чаще этого
const URGENT_THROTTLE_MS = 1_000;
// сервер ответил «0 секунд», а 401 ещё нет — не долбим его каждую секунду
const EXPIRED_RETRY_MS = 5_000;

const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const;

/**
 * Присутствие (контракт REST API, heartbeat): каждые 20 с уходит {active} — была ли
 * активность с прошлого раза. Сервер отвечает, сколько осталось до
 * автоблокировки; отсюда локальный дедлайн и посекундный обратный отсчёт
 * (между пульсами сервер не спрашиваем). Длинные действия — импорт,
 * воспроизведение — отмечают активность через markActivity.
 */
export function useHeartbeat(): {
  /** секунд до автоблокировки, когда осталось ≤ IDLE_WARNING_SEC; иначе null */
  idleWarningSec: number | null;
  markActivity: () => void;
  /** «Остаться»: отметить активность и сразу сообщить серверу */
  stay: () => void;
} {
  const activityRef = useRef(true);
  const inFlight = useRef(false);
  const lastTickAt = useRef(0);
  const warningRef = useRef(false);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [idleWarningSec, setIdleWarningSec] = useState<number | null>(null);

  const tick = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    lastTickAt.current = Date.now();
    // флаг снимаем ДО запроса: активность во время запроса уйдёт следующим пульсом
    const active = activityRef.current;
    activityRef.current = false;
    try {
      const r = await heartbeat(active);
      setDeadline(Date.now() + r.idleRemainingSec * 1000);
    } catch {
      // 401 уже превратился в экран входа; сетевая ошибка — активность не теряем
      if (active) activityRef.current = true;
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    void tick();
    const iv = setInterval(() => void tick(), HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(iv);
  }, [tick]);

  // локальный обратный отсчёт до дедлайна
  useEffect(() => {
    if (deadline === null) return;
    let lastExpiredPing = 0;
    const update = () => {
      const left = Math.ceil((deadline - Date.now()) / 1000);
      const warn = left <= IDLE_WARNING_SEC ? Math.max(0, left) : null;
      warningRef.current = warn !== null;
      setIdleWarningSec(warn); // то же значение (null) не вызывает перерисовки
      if (left <= 0 && Date.now() - lastExpiredPing >= EXPIRED_RETRY_MS) {
        // время вышло: сервер ответит 401 → экран входа
        lastExpiredPing = Date.now();
        void tick();
      }
    };
    update();
    const iv = setInterval(update, 1000);
    return () => clearInterval(iv);
  }, [deadline, tick]);

  useEffect(() => {
    const mark = () => {
      activityRef.current = true;
      // предупреждение на экране: мышь/клавиатура должны его снять сразу, а не через 20 с
      if (warningRef.current && Date.now() - lastTickAt.current >= URGENT_THROTTLE_MS) void tick();
    };
    for (const type of ACTIVITY_EVENTS) window.addEventListener(type, mark, { passive: true });
    const onVisibility = () => {
      if (document.visibilityState === 'visible') mark();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      for (const type of ACTIVITY_EVENTS) window.removeEventListener(type, mark);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [tick]);

  const markActivity = useCallback(() => {
    activityRef.current = true;
  }, []);

  const stay = useCallback(() => {
    activityRef.current = true;
    void tick();
  }, [tick]);

  return { idleWarningSec, markActivity, stay };
}
