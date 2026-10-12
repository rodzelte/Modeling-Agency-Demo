import type { ReactNode } from "react";
import { safeHref } from "./blocks";

// A deliberately small Markdown subset for CMS text blocks, rendered to React
// elements (never raw HTML): ## and ### headings, paragraphs, - and 1. lists,
// > quotes, **bold**, _italic_, and [links](/path). Unsafe links render as text.

function inline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /\[([^\]]{1,200})\]\(([^)\s]{1,500})\)|\*\*([^*]{1,500})\*\*|_([^_]{1,500})_/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = pattern.exec(text))) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const key = `${keyPrefix}-${index++}`;
    if (match[1] !== undefined) {
      const href = match[2];
      if (safeHref.safeParse(href).success) {
        const external = href.startsWith("https://");
        nodes.push(<a key={key} href={href} className="underline underline-offset-4 hover:opacity-70" {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>{match[1]}</a>);
      } else {
        nodes.push(match[1]);
      }
    } else if (match[3] !== undefined) {
      nodes.push(<strong key={key}>{match[3]}</strong>);
    } else if (match[4] !== undefined) {
      nodes.push(<em key={key}>{match[4]}</em>);
    }
    last = pattern.lastIndex;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function withBreaks(text: string, key: string) {
  return text.split("\n").flatMap((line, index) => (index ? [<br key={`${key}-br-${index}`} />, ...inline(line, `${key}-${index}`)] : inline(line, `${key}-${index}`)));
}

export function Markdown({ source, className = "" }: { source: string; className?: string }) {
  // A heading line starts its own block even without a blank line after it.
  const blocks = source.replace(/\r\n/g, "\n").split(/\n{2,}/).map((block) => block.trim()).filter(Boolean)
    .flatMap((block) => block.split(/\n(?=#{2,3} )/)).flatMap((block) => {
      const [first, ...rest] = block.split("\n");
      return /^#{2,3} /.test(first) && rest.length ? [first, rest.join("\n")] : [block];
    });
  return <div className={`cms-prose ${className}`}>{blocks.map((block, index) => {
    const key = `b${index}`;
    const lines = block.split("\n");
    if (block.startsWith("### ")) return <h3 key={key}>{inline(block.slice(4), key)}</h3>;
    if (block.startsWith("## ")) return <h2 key={key}>{inline(block.slice(3), key)}</h2>;
    if (lines.every((line) => /^[-*]\s+/.test(line))) return <ul key={key}>{lines.map((line, i) => <li key={i}>{inline(line.replace(/^[-*]\s+/, ""), `${key}-${i}`)}</li>)}</ul>;
    if (lines.every((line) => /^\d+[.)]\s+/.test(line))) return <ol key={key}>{lines.map((line, i) => <li key={i}>{inline(line.replace(/^\d+[.)]\s+/, ""), `${key}-${i}`)}</li>)}</ol>;
    if (lines.every((line) => line.startsWith(">"))) return <blockquote key={key}>{withBreaks(lines.map((line) => line.replace(/^>\s?/, "")).join("\n"), key)}</blockquote>;
    return <p key={key}>{withBreaks(block, key)}</p>;
  })}</div>;
}
