import { StrictMode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Entry } from '../api/types';
import { UNAUTHORIZED_EVENT } from '../api/client';
import { MARKDOWN_RENDER_LIMIT, TEXT_LIMIT } from '../lib/fileView';
import { makeEntry } from '../test/factories';
import { isViewable, MediaViewer } from './MediaViewer';

// Аудио и текстовые файлы в просмотрщике: распознавание, плеер с переходом к следующему
// треку, текст с лимитом, кодировкой и защитой от двоичных файлов.

const voice = makeEntry({ id: 1, name: 'голос.oga', mime: 'application/octet-stream', size: 5000 });
const note = makeEntry({ id: 2, name: 'заметка.md', mime: 'text/plain', size: 12 });
const photo = makeEntry({ id: 3, kind: 'photo', name: 'кот.jpg', mime: 'image/jpeg' });
const song = makeEntry({ id: 4, name: 'песня.flac', mime: 'application/octet-stream', size: 9000 });

function show(items: Entry[], index: number, extra: { onIndex?: (i: number) => void; onClose?: () => void } = {}) {
  return render(
    <MediaViewer
      items={items}
      index={index}
      onIndex={extra.onIndex ?? vi.fn()}
      onClose={extra.onClose ?? vi.fn()}
      onActivity={vi.fn()}
    />,
  );
}

function stubFetch(body: Uint8Array, status = 200) {
  const fetchMock = vi.fn(async () => new Response(body, { status }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

// lazy-чанк MarkdownView: в общем прогоне первый import дольше секунды findBy
beforeAll(async () => {
  await import('./MarkdownView');
});

beforeEach(() => {
  // jsdom не играет медиа
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup(); // размонтировать до снятия заглушек play/pause/load
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('isViewable', () => {
  it('аудио и текстовые файлы листаются, прочие файлы - нет', () => {
    expect(isViewable(voice)).toBe(true);
    expect(isViewable(note)).toBe(true);
    expect(isViewable(makeEntry({ name: 'отчёт.docx', mime: 'application/zip' }))).toBe(false);
  });
});

describe('аудио', () => {
  it('плеер на содержимое файла; доиграв - следующее аудио, фото пропускается', () => {
    const onIndex = vi.fn();
    show([voice, photo, song], 0, { onIndex });
    expect(screen.getByRole('dialog', { name: 'Прослушивание' })).toBeInTheDocument();
    const audio = document.querySelector('audio');
    expect(audio?.getAttribute('src')).toBe('/api/v1/media/1/content');
    fireEvent.ended(audio!);
    expect(onIndex).toHaveBeenCalledWith(2);
  });

  it('во время ввода (описание, тег) трек не сменяется сам', () => {
    const onIndex = vi.fn();
    show([voice, song], 0, { onIndex });
    const field = document.createElement('textarea');
    document.body.appendChild(field);
    field.focus();
    fireEvent.ended(document.querySelector('audio')!);
    expect(onIndex).not.toHaveBeenCalled();
    field.remove();
  });

  it('последний трек доиграл - остаётся на месте (без круга)', () => {
    const onIndex = vi.fn();
    show([voice, photo, song], 2, { onIndex });
    fireEvent.ended(document.querySelector('audio')!);
    expect(onIndex).not.toHaveBeenCalled();
  });

  it('пробел - пауза/воспроизведение, просмотр не закрывается', () => {
    const onClose = vi.fn();
    show([voice], 0, { onClose });
    const audio = document.querySelector('audio')!;
    Object.defineProperty(audio, 'paused', { configurable: true, value: true });
    fireEvent.keyDown(window, { key: ' ' });
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('уход с трека обрывает поток; в StrictMode плеер не теряет src', () => {
    const view = render(
      <StrictMode>
        <MediaViewer items={[voice, song]} index={0} onIndex={vi.fn()} onClose={vi.fn()} onActivity={vi.fn()} />
      </StrictMode>,
    );
    const first = document.querySelector('audio')!;
    expect(first.getAttribute('src')).toBe('/api/v1/media/1/content'); // двойной прогон эффектов
    view.rerender(
      <StrictMode>
        <MediaViewer items={[voice, song]} index={1} onIndex={vi.fn()} onClose={vi.fn()} onActivity={vi.fn()} />
      </StrictMode>,
    );
    expect(first.hasAttribute('src')).toBe(false); // старый элемент отпустил соединение
    expect(HTMLMediaElement.prototype.load).toHaveBeenCalled();
    expect(document.querySelector('audio')?.getAttribute('src')).toBe('/api/v1/media/4/content');
  });

  it('видео: пробел по-прежнему ставит на паузу (общий mediaRef с аудио)', () => {
    const clip = makeEntry({ id: 20, kind: 'video', name: 'clip.mp4', mime: 'video/mp4' });
    show([clip], 0);
    const video = document.querySelector('video')!;
    Object.defineProperty(video, 'paused', { configurable: true, value: false });
    fireEvent.keyDown(window, { key: ' ' });
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
  });

  it('браузер не играет формат - «Скачать»', () => {
    show([voice], 0);
    fireEvent.error(document.querySelector('audio')!);
    expect(screen.getByText('Браузер не может воспроизвести этот аудиоформат.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Скачать' })).toBeInTheDocument();
  });
});

describe('текст', () => {
  it('показывает текст файла, без Range у небольшого', async () => {
    const fetchMock = stubFetch(new TextEncoder().encode('# Заголовок\nстрока'));
    show([makeEntry({ id: 2, name: 'список.txt', mime: 'text/plain', size: 12 })], 0);
    expect(screen.getByRole('dialog', { name: 'Просмотр текста' })).toBeInTheDocument();
    expect(await screen.findByText(/# Заголовок\s+строка/)).toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/v1/media/2/content');
    expect(init.headers).toBeUndefined();
    expect(screen.queryByText(/Кодировка/)).toBeNull();
    // область текста в фокусе - стрелки и пробел листают текст (фокус ставит эффект)
    await waitFor(() => expect(screen.getByLabelText('Текст файла')).toHaveFocus());
  });

  it('заметка .md - с оформлением, «Исходный текст» показывает разметку', async () => {
    stubFetch(new TextEncoder().encode('# Заголовок\n\n**жирный**'));
    show([note], 0);
    expect(await screen.findByRole('heading', { level: 1, name: 'Заголовок' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Исходный текст' }));
    expect(screen.getByText(/# Заголовок\s+\*\*жирный\*\*/)).toBeInTheDocument();
    expect(screen.getByLabelText('Текст файла')).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Оформление' }));
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
  });

  it('огромная заметка открывается исходником', async () => {
    stubFetch(new TextEncoder().encode('# x\n' + 'a'.repeat(MARKDOWN_RENDER_LIMIT)));
    show([makeEntry({ id: 10, name: 'огромная.md', size: MARKDOWN_RENDER_LIMIT + 4 })], 0);
    expect(await screen.findByRole('button', { name: 'Оформление' })).toBeInTheDocument();
    expect(screen.queryByRole('heading')).toBeNull();
  });

  it('большой - запрашивается начало (Range) и есть пометка', async () => {
    const big = makeEntry({ id: 7, name: 'лог.log', size: TEXT_LIMIT * 3 });
    const fetchMock = stubFetch(new TextEncoder().encode('начало'), 206);
    show([big], 0);
    expect(await screen.findByText(/Показано начало: 2\.0 МБ из 6\.0 МБ/)).toBeInTheDocument();
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.headers).toEqual({ Range: `bytes=0-${TEXT_LIMIT - 1}` });
    expect(screen.getByRole('button', { name: 'Скачать целиком' })).toBeInTheDocument();
  });

  it('сервер не понял Range (200 с телом больше лимита) - читается только начало', async () => {
    const big = makeEntry({ id: 7, name: 'лог.log', size: TEXT_LIMIT * 3 });
    let pulled = 0;
    let cancelled = false;
    const chunk = new TextEncoder().encode('x'.repeat(1 << 20));
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled += 1;
        if (pulled > 50) c.close(); // 50 МБ - не должно быть дочитано
        else c.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200 })));
    show([big], 0);
    expect(await screen.findByText(/Показано начало/)).toBeInTheDocument();
    expect(cancelled).toBe(true);
    expect(pulled).toBeLessThan(10);
    expect(screen.getByLabelText('Текст файла').textContent).toHaveLength(TEXT_LIMIT);
  });

  it('размер записи устарел (0), а файл больше лимита - тоже обрезка с пометкой', async () => {
    stubFetch(new Uint8Array(TEXT_LIMIT + 10).fill(0x61));
    show([makeEntry({ id: 6, name: 'старый.txt', size: 0 })], 0);
    expect(await screen.findByText(/Показано начало/)).toBeInTheDocument();
  });

  it('пустой файл - пустая область без ошибки', async () => {
    stubFetch(new Uint8Array());
    show([makeEntry({ id: 5, name: 'пусто.txt', size: 0 })], 0);
    await waitFor(() => expect(screen.getByLabelText('Текст файла')).toBeInTheDocument());
    expect(screen.getByLabelText('Текст файла').textContent).toBe('');
  });

  it('загрузка закончилась, пока пишут в поле, - фокус остаётся в поле', async () => {
    let finish: (r: Response) => void = () => undefined;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((r) => (finish = r))));
    show([note], 0);
    const field = document.createElement('input');
    document.body.appendChild(field);
    field.focus();
    finish(new Response(new TextEncoder().encode('текст')));
    await screen.findByText('текст');
    expect(field).toHaveFocus();
    field.remove();
  });

  it('401 - сессия кончилась: общий выход на экран входа', async () => {
    const onUnauthorized = vi.fn();
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    stubFetch(new Uint8Array(), 401);
    show([note], 0);
    await waitFor(() => expect(onUnauthorized).toHaveBeenCalled());
    window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  });

  it('windows-1251 распознаётся и подписывается', async () => {
    stubFetch(new Uint8Array([0xcc, 0xe8, 0xf0]));
    show([makeEntry({ id: 8, name: 'старое.txt', size: 3 })], 0);
    expect(await screen.findByText('Мир')).toBeInTheDocument();
    expect(screen.getByText('Кодировка: Windows-1251')).toBeInTheDocument();
  });

  it('двоичное содержимое не выводится', async () => {
    stubFetch(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]));
    show([makeEntry({ id: 9, name: 'не текст.json', size: 6 })], 0);
    expect(await screen.findByText('Это не текст: в файле двоичные данные.')).toBeInTheDocument();
  });

  it('ошибка сервера - «Не удалось загрузить файл»', async () => {
    stubFetch(new Uint8Array(), 404);
    show([note], 0);
    expect(await screen.findByText('Не удалось загрузить файл.')).toBeInTheDocument();
  });

  it('пробел в тексте не закрывает просмотр и не перехватывается', async () => {
    stubFetch(new TextEncoder().encode('текст'));
    const onClose = vi.fn();
    show([note], 0, { onClose });
    await screen.findByText('текст');
    const ev = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('уход с записи обрывает запрос', async () => {
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) => {
        signal = init.signal ?? undefined;
        return new Promise<Response>(() => undefined);
      }),
    );
    const view = show([note, voice], 0);
    await waitFor(() => expect(signal).toBeDefined());
    view.rerender(
      <MediaViewer items={[note, voice]} index={1} onIndex={vi.fn()} onClose={vi.fn()} onActivity={vi.fn()} />,
    );
    expect(signal?.aborted).toBe(true);
  });
});
