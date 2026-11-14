import { describe, expect, test } from "bun:test";
import { parseReply } from "./reply.ts";

describe("parseReply", () => {
  test("reads the structured reply", () => {
    expect(parseReply('{"message":"Pick one","choices":["a","b"]}')).toEqual({
      message: "Pick one",
      choices: ["a", "b"],
    });
  });

  test("falls back to plain text when the reply is not the expected JSON", () => {
    expect(parseReply("just text")).toEqual({ message: "just text", choices: [] });
    expect(parseReply('{"text":"x"}')).toEqual({ message: '{"text":"x"}', choices: [] });
  });

  test("cleans choices: trims, drops blanks and duplicates, caps count and length", () => {
    const long = "x".repeat(100);
    const { choices } = parseReply(
      JSON.stringify({ message: "m", choices: [" a ", "", "a", "b", "c", "d", long, "f"] }),
    );
    expect(choices.slice(0, 4)).toEqual(["a", "b", "c", "d"]);
    expect(choices).toHaveLength(5);
    expect(choices[4]).toHaveLength(75);
  });
});
