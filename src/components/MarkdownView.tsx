import Markdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Заметка .md с оформлением (react-markdown + GFM: таблицы, списки задач, зачёркивание).
 * Безопасность: react-markdown строит React-элементы, сырой HTML из заметки не
 * исполняется и не вставляется (rehype-raw не подключён, skipHtml). Картинки не
 * грузятся: относительные пути заметки в сейфе не адресуемы, чужие сайты закрыты CSP -
 * вместо картинки подпись. Ссылки: http(s)/mailto - в новой вкладке без referrer,
 * прочие (относительные, на другие заметки) - просто текст, чтобы не уводить окно сейфа.
 * Отдельный чанк (lazy в MediaViewer): основной бандл не растёт.
 */

const EXTERNAL = /^(https?:|mailto:)/i;

const components: Components = {
  a: ({ href, children }) =>
    href !== undefined && EXTERNAL.test(href) ? (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    ) : (
      <span className="md-dead-link" title={href}>
        {children}
      </span>
    ),
  img: ({ alt, src }) => (
    <span className="md-image" title={src}>
      🖼 {alt !== undefined && alt !== '' ? alt : 'картинка'}
    </span>
  ),
};

export default function MarkdownView({ text }: { text: string }) {
  return (
    <div className="md-view">
      <Markdown remarkPlugins={[remarkGfm]} components={components} skipHtml>
        {text}
      </Markdown>
    </div>
  );
}
