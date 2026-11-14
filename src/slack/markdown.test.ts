import { describe, expect, test } from "bun:test";
import { splitMarkdown } from "./markdown.ts";

describe("splitMarkdown", () => {
  test("keeps short text as one message", () => {
    expect(splitMarkdown("  hello  ")).toEqual(["hello"]);
  });

  test("splits on paragraph boundaries within the limit", () => {
    const text = ["a".repeat(40), "b".repeat(40), "c".repeat(40)].join("\n\n");
    const parts = splitMarkdown(text, 100);
    expect(parts).toEqual([`${"a".repeat(40)}\n\n${"b".repeat(40)}`, "c".repeat(40)]);
    expect(parts.every((p) => p.length <= 100)).toBe(true);
  });

  test("hard-splits text without line breaks", () => {
    expect(splitMarkdown("x".repeat(250), 100).map((p) => p.length)).toEqual([100, 100, 50]);
  });

  test("closes and reopens a code block that is split", () => {
    const code = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n");
    const parts = splitMarkdown(`\`\`\`\n${code}\n\`\`\``, 100);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect((part.match(/^```/gm) ?? []).length % 2).toBe(0);
    }
  });
});
