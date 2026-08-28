/**
 * Minimal, dependency-free renderer for the small subset of markdown the
 * assistant's replies actually use: **bold**, "- "/"* " bullets, "1. "
 * numbered lists, and "## " headings. Not a full CommonMark parser — just
 * enough so AI-formatted replies (e.g. spec summaries) render as real
 * formatting instead of literal ** and - characters.
 */

function renderInline(text: string, keyPrefix: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
      <strong key={`${keyPrefix}-${i}`} className="font-semibold text-foreground">
        {part.slice(2, -2)}
      </strong>
    ) : (
      part
    ),
  );
}

type Block =
  | { type: "heading"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "paragraph"; text: string };

function parseBlocks(text: string): Block[] {
  const lines = text.split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  function flushParagraph() {
    if (paragraph.length > 0) {
      blocks.push({ type: "paragraph", text: paragraph.join("\n") });
      paragraph = [];
    }
  }
  function flushList() {
    if (list) {
      blocks.push({ type: "list", ordered: list.ordered, items: list.items });
      list = null;
    }
  }

  for (const line of lines) {
    const bullet = /^\s*[-*]\s+(.+)/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.+)/.exec(line);
    const heading = /^\s*#{1,4}\s+(.+)/.exec(line);

    if (bullet || numbered) {
      flushParagraph();
      const ordered = !!numbered;
      const content = (bullet ?? numbered)![1];
      if (list && list.ordered === ordered) {
        list.items.push(content);
      } else {
        flushList();
        list = { ordered, items: [content] };
      }
      continue;
    }

    flushList();

    if (heading) {
      flushParagraph();
      blocks.push({ type: "heading", text: heading[1] });
      continue;
    }

    if (line.trim() === "") {
      flushParagraph();
      continue;
    }

    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  return blocks;
}

export function MarkdownLite({ text, className = "" }: { text: string; className?: string }) {
  const blocks = parseBlocks(text);
  return (
    <div className={className}>
      {blocks.map((block, i) => {
        if (block.type === "heading") {
          return (
            <p key={i} className="mt-2.5 text-[13px] font-semibold text-foreground first:mt-0">
              {renderInline(block.text, `h${i}`)}
            </p>
          );
        }
        if (block.type === "list") {
          const Tag = block.ordered ? "ol" : "ul";
          return (
            <Tag
              key={i}
              className={`mt-2 space-y-1 pl-5 first:mt-0 ${block.ordered ? "list-decimal" : "list-disc"}`}
            >
              {block.items.map((item, j) => (
                <li key={j} className="leading-relaxed">
                  {renderInline(item, `l${i}-${j}`)}
                </li>
              ))}
            </Tag>
          );
        }
        return (
          <p key={i} className="mt-2 whitespace-pre-wrap leading-relaxed first:mt-0">
            {renderInline(block.text, `p${i}`)}
          </p>
        );
      })}
    </div>
  );
}
