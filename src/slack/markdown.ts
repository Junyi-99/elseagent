/** Slack's limit for `markdown_text` is 12,000 characters; stay under it. */
export const SLACK_MARKDOWN_LIMIT = 11_000;

/**
 * Split long Markdown into Slack-sized messages, preferring paragraph, then line, boundaries.
 * A code block that has to be split is closed and reopened so each part renders.
 */
export function splitMarkdown(text: string, limit = SLACK_MARKDOWN_LIMIT): string[] {
  const parts: string[] = [];
  let rest = text.trim();
  while (rest.length > limit) {
    let cut = rest.lastIndexOf("\n\n", limit);
    if (cut < limit / 2) cut = rest.lastIndexOf("\n", limit);
    if (cut < limit / 2) cut = limit;
    let part = rest.slice(0, cut).trimEnd();
    rest = rest.slice(cut).trimStart();
    // An odd number of fences means we are inside a code block: close it here, reopen next.
    if ((part.match(/^```/gm)?.length ?? 0) % 2 === 1) {
      part += "\n```";
      rest = `\`\`\`\n${rest}`;
    }
    parts.push(part);
  }
  if (rest) parts.push(rest);
  return parts;
}
