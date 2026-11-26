import { afterEach, describe, expect, it } from 'vitest';
import { suppressBrowserContextMenu } from './dom';

describe('меню браузера по правому клику', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    window.getSelection()?.removeAllRanges();
  });

  const fire = (el: HTMLElement) => {
    const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    el.addEventListener('contextmenu', suppressBrowserContextMenu);
    el.dispatchEvent(e);
    return e.defaultPrevented;
  };

  it('на интерфейсе - подавлено', () => {
    const div = document.body.appendChild(document.createElement('div'));
    expect(fire(div)).toBe(true);
  });

  it('в поле ввода и над выделенным текстом - остаётся', () => {
    const input = document.body.appendChild(document.createElement('input'));
    expect(fire(input)).toBe(false);
    const p = document.body.appendChild(document.createElement('p'));
    p.textContent = 'текст';
    const range = document.createRange();
    range.selectNodeContents(p);
    window.getSelection()?.addRange(range);
    expect(fire(p)).toBe(false);
  });
});
