import { describe, expect, test } from "bun:test";
import { CHOICE_ACTION, CHOICES_BLOCK_ID, choiceBlocks, resolvedBlocks } from "./choices.ts";

describe("choice buttons", () => {
  test("one button per choice, carrying the choice as its value", () => {
    const blocks = choiceBlocks("Which branch?", ["main", "release"]);
    expect(blocks[0]).toEqual({ type: "markdown", text: "Which branch?" });
    const actions = blocks[1] as {
      block_id: string;
      elements: { action_id: string; value: string }[];
    };
    expect(actions.block_id).toBe(CHOICES_BLOCK_ID);
    expect(actions.elements.map((e) => e.value)).toEqual(["main", "release"]);
    expect(actions.elements.every((e) => CHOICE_ACTION.test(e.action_id))).toBe(true);
  });

  test("after a pick, the buttons are replaced by who chose what", () => {
    const after = resolvedBlocks(choiceBlocks("Which?", ["a", "b"]), "U1", "b");
    expect(after).toEqual([
      { type: "markdown", text: "Which?" },
      { type: "context", elements: [{ type: "mrkdwn", text: "<@U1> chose *b*" }] },
    ]);
  });
});
