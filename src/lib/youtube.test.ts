import { describe, expect, it } from 'vitest';
import { buildCatalog } from './tags';
import { embedState, embedUrl, parseStart, parseYouTube, watchUrl } from './youtube';

const ID = 'jNQXAC9IVRw';

describe('parseYouTube', () => {
  it('watch, youtu.be, shorts, live, embed, m. и music.', () => {
    expect(parseYouTube(`https://www.youtube.com/watch?v=${ID}`)).toEqual({ id: ID, short: false, start: 0 });
    expect(parseYouTube(`https://youtu.be/${ID}?si=abc`)?.id).toBe(ID);
    expect(parseYouTube(`https://youtube.com/shorts/${ID}`)).toEqual({ id: ID, short: true, start: 0 });
    expect(parseYouTube(`https://www.youtube.com/live/${ID}?feature=share`)?.id).toBe(ID);
    expect(parseYouTube(`https://www.youtube-nocookie.com/embed/${ID}`)?.id).toBe(ID);
    expect(parseYouTube(`https://m.youtube.com/watch?v=${ID}&list=PL1`)?.id).toBe(ID);
    expect(parseYouTube(`https://music.youtube.com/watch?v=${ID}`)?.id).toBe(ID);
  });

  it('время начала: t=90, t=1m30s, start=', () => {
    expect(parseYouTube(`https://youtu.be/${ID}?t=90`)?.start).toBe(90);
    expect(parseYouTube(`https://www.youtube.com/watch?v=${ID}&t=1m30s`)?.start).toBe(90);
    expect(parseYouTube(`https://www.youtube.com/embed/${ID}?start=15`)?.start).toBe(15);
  });

  it('не ролик: канал, плейлист, чужой сайт, кривой id, не http', () => {
    expect(parseYouTube('https://www.youtube.com/@channel')).toBeNull();
    expect(parseYouTube('https://www.youtube.com/playlist?list=PL1')).toBeNull();
    expect(parseYouTube(`https://example.com/watch?v=${ID}`)).toBeNull();
    expect(parseYouTube(`https://notyoutube.com/watch?v=${ID}`)).toBeNull();
    expect(parseYouTube('https://youtu.be/short')).toBeNull();
    expect(parseYouTube(`javascript:alert(1)//youtu.be/${ID}`)).toBeNull();
    expect(parseYouTube(undefined)).toBeNull();
    expect(parseYouTube('не адрес')).toBeNull();
  });
});

describe('parseStart', () => {
  it('секунды и h/m/s; мусор - 0', () => {
    expect(parseStart('42')).toBe(42);
    expect(parseStart('1h2m3s')).toBe(3723);
    expect(parseStart('2m')).toBe(120);
    expect(parseStart('abc')).toBe(0);
    expect(parseStart('')).toBe(0);
    expect(parseStart(null)).toBe(0);
  });
});

describe('адреса плеера и страницы', () => {
  it('embed - youtube-nocookie с автозапуском и стартом', () => {
    const url = new URL(embedUrl({ id: ID, short: false, start: 90 }));
    expect(url.origin).toBe('https://www.youtube-nocookie.com');
    expect(url.pathname).toBe(`/embed/${ID}`);
    expect(url.searchParams.get('autoplay')).toBe('1');
    expect(url.searchParams.get('start')).toBe('90');
  });

  it('страница ролика: шортс - shorts/, обычный - watch с t', () => {
    expect(watchUrl({ id: ID, short: true, start: 0 })).toBe(`https://www.youtube.com/shorts/${ID}`);
    expect(watchUrl({ id: ID, short: false, start: 5 })).toBe(`https://www.youtube.com/watch?v=${ID}&t=5s`);
  });
});

describe('embedState', () => {
  const catalog = buildCatalog([
    {
      id: 1,
      name: 'YouTube',
      nameEn: '',
      tags: [
        { id: 10, categoryId: 1, name: 'Без встраивания', nameEn: '', count: 1 },
        { id: 11, categoryId: 1, name: 'Недоступно', nameEn: '', count: 1 },
        { id: 12, categoryId: 1, name: 'Музыка', nameEn: '', count: 1 },
      ],
    },
    { id: 2, name: 'Прочее', nameEn: '', tags: [{ id: 20, categoryId: 2, name: 'Недоступно', nameEn: '', count: 1 }] },
  ]);
  const tags = (...ids: number[]) => ({ tags: ids.map((tagId) => ({ tagId, inherit: false })) });

  it('без тегов-запретов - можно встроить', () => {
    expect(embedState(tags(), catalog)).toBe('ok');
    expect(embedState(tags(12), catalog)).toBe('ok');
    expect(embedState(tags(20), catalog)).toBe('ok'); // «Недоступно» из другой категории не в счёт
  });

  it('«Без встраивания» и «Недоступно»; второе важнее', () => {
    expect(embedState(tags(10), catalog)).toBe('noembed');
    expect(embedState(tags(11), catalog)).toBe('gone');
    expect(embedState(tags(10, 11), catalog)).toBe('gone');
  });
});
