import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import MarkdownView from './MarkdownView';

// Заметки .md: оформление GFM и безопасность (HTML, ссылки, картинки).

describe('MarkdownView', () => {
  it('заголовки, выделение, списки, таблица и список задач', () => {
    const { container } = render(
      <MarkdownView
        text={'# Заголовок\n\n**жирный** и ~~зачёркнутый~~\n\n- [x] готово\n- [ ] нет\n\n| a | b |\n|---|---|\n| 1 | 2 |\n'}
      />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Заголовок' })).toBeInTheDocument();
    expect(container.querySelector('strong')?.textContent).toBe('жирный');
    expect(container.querySelector('del')?.textContent).toBe('зачёркнутый');
    expect(container.querySelectorAll('input[type=checkbox]')).toHaveLength(2);
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('сырой HTML не вставляется', () => {
    const { container } = render(
      <MarkdownView text={'<script>window.x=1</script>\n\n<img src=x onerror="alert(1)">\n\n<b>жир</b> текст'} />,
    );
    expect(container.querySelector('script, img, b, iframe')).toBeNull();
  });

  it('внешняя ссылка - новая вкладка без referrer; javascript: и относительные - текст', () => {
    const { container } = render(
      <MarkdownView text={'[сайт](https://example.com) [почта](mailto:a@b.c) [зло](javascript:alert(1)) [заметка](other.md)'} />,
    );
    const links = [...container.querySelectorAll('a')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['https://example.com', 'mailto:a@b.c']);
    for (const a of links) {
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    }
    expect(screen.getByText('зло').tagName).toBe('SPAN');
    expect(screen.getByText('заметка').tagName).toBe('SPAN');
  });

  it('картинки не грузятся - подпись вместо них', () => {
    const { container } = render(<MarkdownView text={'![схема](img/a.png) ![](https://example.com/b.png)'} />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText(/схема/)).toBeInTheDocument();
    expect(screen.getByText(/картинка/)).toBeInTheDocument();
  });
});
