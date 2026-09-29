import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { ApiRequestError } from '../api/client';
import { makeEntry } from '../test/factories';
import type { Resolutions } from '../lib/importPlan';
import { useMoveEntries } from './useMoveEntries';

const mocks = vi.hoisted(() => ({
  planMove: vi.fn(),
  moveEntries: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('../api/endpoints', async (original) => ({
  ...(await original<typeof import('../api/endpoints')>()),
  planMove: mocks.planMove,
  moveEntries: mocks.moveEntries,
}));
vi.mock('../components/Toasts', () => ({ useToast: () => mocks.toast }));

const photo = makeEntry({ id: 1, kind: 'photo', name: 'кот.jpg', size: 9, modifiedAt: 70 });
const folder = makeEntry({ id: 2, kind: 'folder', name: 'Папка' });

function setup(answer: Resolutions | null = new Map()) {
  const onDone = vi.fn();
  const askConflicts = vi.fn(() => Promise.resolve(answer));
  const { result } = renderHook(() => useMoveEntries({ askConflicts, onDone }));
  return { move: result.current, onDone, askConflicts };
}

beforeEach(() => vi.clearAllMocks());

describe('useMoveEntries', () => {
  it('нет конфликтов - сразу перемещение и тост', async () => {
    mocks.planMove.mockResolvedValue({ conflicts: [] });
    mocks.moveEntries.mockResolvedValue({ moved: 2, replaced: 0, skipped: 0 });
    const { move, onDone, askConflicts } = setup();
    await act(() => move([photo, folder], 9));
    expect(mocks.planMove).toHaveBeenCalledWith([1, 2], 9);
    expect(askConflicts).not.toHaveBeenCalled();
    expect(mocks.moveEntries).toHaveBeenCalledWith([1, 2], 9, undefined);
    expect(mocks.toast).toHaveBeenCalledWith('Перемещено: 2', 'success');
    expect(onDone).toHaveBeenCalledWith(true);
  });

  it('перемещение в корень - parentId null', async () => {
    mocks.planMove.mockResolvedValue({ conflicts: [] });
    mocks.moveEntries.mockResolvedValue({ moved: 1, replaced: 0, skipped: 0 });
    const { move } = setup();
    await act(() => move([photo], null));
    expect(mocks.moveEntries).toHaveBeenCalledWith([1], null, undefined);
  });

  it('занятые имена - тот же диалог, решения уходят по id записи', async () => {
    mocks.planMove.mockResolvedValue({
      conflicts: [{ id: 1, existing: makeEntry({ id: 50, name: 'кот.jpg', size: 4, modifiedAt: 20 }) }],
    });
    mocks.moveEntries.mockResolvedValue({ moved: 1, replaced: 1, skipped: 0 });
    const { move, askConflicts } = setup(new Map([['1', 'replace']] as const));
    await act(() => move([photo, folder], 9));
    expect(askConflicts).toHaveBeenCalledWith({
      kind: 'move',
      items: [
        {
          key: '1',
          name: 'кот.jpg',
          incoming: { folder: false, size: 9, modifiedAt: 70 },
          existing: { folder: false, size: 4, modifiedAt: 20 },
        },
      ],
    });
    expect(mocks.moveEntries).toHaveBeenCalledWith([1, 2], 9, { '1': 'replace' });
    expect(mocks.toast).toHaveBeenCalledWith('Перемещено: 1, заменено: 1', 'success');
  });

  it('отмена диалога - ничего не перемещается', async () => {
    mocks.planMove.mockResolvedValue({ conflicts: [{ id: 1, existing: makeEntry({ id: 50 }) }] });
    const { move, onDone } = setup(null);
    await act(() => move([photo], 9));
    expect(mocks.moveEntries).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledWith(false);
  });

  it('в себя или потомка - тост с сообщением сервера, выделение остаётся', async () => {
    mocks.planMove.mockRejectedValue(
      new ApiRequestError(422, 'invalid_argument', 'Нельзя переместить запись в саму себя или в её вложение'),
    );
    const { move, onDone } = setup();
    await act(() => move([folder], 2));
    expect(mocks.moveEntries).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith(
      'Нельзя переместить запись в саму себя или в её вложение',
      'error',
    );
    expect(onDone).toHaveBeenCalledWith(false);
  });

  it('ошибка самого перемещения - тоже тост', async () => {
    mocks.planMove.mockResolvedValue({ conflicts: [] });
    mocks.moveEntries.mockRejectedValue(new ApiRequestError(422, 'invalid_argument', 'Нельзя'));
    const { move, onDone } = setup();
    await act(() => move([photo], 9));
    expect(mocks.toast).toHaveBeenCalledWith('Нельзя', 'error');
    expect(onDone).toHaveBeenCalledWith(false);
  });

  it('401 - без тоста: приложение само покажет экран входа', async () => {
    mocks.planMove.mockRejectedValue(new ApiRequestError(401, 'unauthorized', 'Требуется вход'));
    const { move } = setup();
    await act(() => move([photo], 9));
    expect(mocks.toast).not.toHaveBeenCalled();
  });
});
