import { Marked } from "marked";

// Markdown sicher in HTML umwandeln: eingebettetes HTML wird nicht ausgeführt, sondern als Text gezeigt,
// Links nur zu http(s), mailto, tel und relativen Zielen.

const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const safeHref = (href: string) => (/^(https?:|mailto:|tel:|\/|#)/i.test(href.trim()) ? href.trim() : null);

const marked = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    html({ text }) {
      return escape(text);
    },
    link({ href, title, tokens }) {
      const label = this.parser.parseInline(tokens);
      const target = safeHref(href);
      if (!target) return label;
      const external = /^https?:/i.test(target);
      return `<a href="${escape(target)}"${title ? ` title="${escape(title)}"` : ""}${external ? ' target="_blank" rel="noreferrer"' : ""}>${label}</a>`;
    },
    image({ href, text }) {
      const target = safeHref(href);
      return target && /^https?:/i.test(target) ? `<img src="${escape(target)}" alt="${escape(text)}" loading="lazy">` : escape(text);
    },
  },
});

export function renderMarkdown(source: string): string {
  return marked.parse(source, { async: false }) as string;
}
