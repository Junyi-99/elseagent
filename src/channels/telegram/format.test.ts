import { describe, expect, test } from "bun:test";
import { plainLine, toTelegramHtml } from "./format.ts";

describe("toTelegramHtml", () => {
  test("inline formatting, escaping and links", () => {
    expect(
      toTelegramHtml("**bold** _it_ ~~gone~~ `a<b` & <i>raw</i> [docs](https://x.io?a=1&b=2)"),
    ).toBe(
      '<b>bold</b> <i>it</i> <s>gone</s> <code>a&lt;b</code> &amp; &lt;i&gt;raw&lt;/i&gt; <a href="https://x.io?a=1&amp;b=2">docs</a>',
    );
  });

  test("headings, lists, code blocks and quotes", () => {
    const md =
      "## Done\n\n- one\n- two\n  - nested\n\n1. a\n2. b\n\n```ts\nif (a < b) {}\n```\n\n> note";
    expect(toTelegramHtml(md)).toBe(
      [
        "<b>Done</b>",
        "",
        "• one\n• two\n   • nested",
        "",
        "1. a\n2. b",
        "",
        '<pre><code class="language-ts">if (a &lt; b) {}</code></pre>',
        "",
        "<blockquote>note</blockquote>",
      ].join("\n"),
    );
  });

  test("tables become preformatted text", () => {
    expect(toTelegramHtml("| a | b |\n|---|---|\n| **1** | 2 |")).toBe("<pre>a | b\n1 | 2</pre>");
  });

  test("mentions link to the user, with a name when known", () => {
    expect(toTelegramHtml("Stopped by <@42>.", (id) => (id === "42" ? "Ann" : undefined))).toBe(
      'Stopped by <a href="tg://user?id=42">Ann</a>.',
    );
    expect(toTelegramHtml("<@7>")).toBe('<a href="tg://user?id=7">7</a>');
  });
});

test("plainLine: first non-empty line without markup, clipped", () => {
  expect(plainLine("\n## CI is **green** & fast\n\nmore", 80)).toBe("CI is green & fast");
  expect(plainLine("abcdefghij", 5)).toBe("abcd…");
});
