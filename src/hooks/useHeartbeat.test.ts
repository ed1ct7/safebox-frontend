import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { HEARTBEAT_INTERVAL_MS, useHeartbeat } from './useHeartbeat';

const heartbeat = vi.fn<(active: boolean) => Promise<{ idleRemainingSec: number }>>();

vi.mock('../api/endpoints', () => ({
  heartbeat: (active: boolean) => heartbeat(active),
}));

/** Дать отработать промисам (ответ heartbeat) при фейковых таймерах. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useHeartbeat (UF-13)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    heartbeat.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('далеко до блокировки — предупреждения нет', async () => {
    heartbeat.mockResolvedValue({ idleRemainingSec: 900 });
    const { result } = renderHook(() => useHeartbeat());
    await flush();
    expect(heartbeat).toHaveBeenCalledWith(true); // первый пульс — «активен»
    expect(result.current.idleWarningSec).toBeNull();
  });

  it('за минуту — предупреждение с посекундным отсчётом между пульсами', async () => {
    heartbeat.mockResolvedValue({ idleRemainingSec: 45 });
    const { result } = renderHook(() => useHeartbeat());
    await flush();
    expect(result.current.idleWarningSec).toBe(45);
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(result.current.idleWarningSec).toBe(40);
  });

  it('активность во время предупреждения уходит сразу, не через 20 с', async () => {
    heartbeat.mockResolvedValue({ idleRemainingSec: 30 });
    renderHook(() => useHeartbeat());
    await flush();
    heartbeat.mockClear();
    act(() => {
      vi.advanceTimersByTime(1_500);
      window.dispatchEvent(new Event('keydown'));
    });
    expect(heartbeat).toHaveBeenCalledWith(true);
  });

  it('без активности следующий пульс — active=false', async () => {
    heartbeat.mockResolvedValue({ idleRemainingSec: 900 });
    renderHook(() => useHeartbeat());
    await flush();
    act(() => {
      vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
    });
    await flush();
    expect(heartbeat).toHaveBeenLastCalledWith(false);
  });

  it('пульс не дошёл — активность не теряется', async () => {
    heartbeat.mockRejectedValueOnce(new Error('network'));
    heartbeat.mockResolvedValue({ idleRemainingSec: 900 });
    renderHook(() => useHeartbeat());
    await flush();
    act(() => {
      vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
    });
    await flush();
    expect(heartbeat.mock.calls.map((c) => c[0])).toEqual([true, true]);
  });
});
