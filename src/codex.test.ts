import { describe, expect, test } from "bun:test";
import { Codex } from "@openai/codex-sdk";
import { createCodex } from "./codex.ts";
import { ConfigError, configSchema } from "./config.ts";

const codexConfig = (codex: Record<string, unknown>) =>
  configSchema.parse({ slack: { botToken: "a", appToken: "b" }, codex }).codex;

describe("createCodex", () => {
  test("uses codex.path when it resolves", () => {
    expect(createCodex(codexConfig({ path: "true" }))).toBeInstanceOf(Codex);
  });

  test("rejects a codex.path that does not exist", () => {
    expect(() => createCodex(codexConfig({ path: "/nope/codex" }))).toThrow(ConfigError);
  });

  test("falls back to the bundled @openai/codex when running from source", () => {
    expect(createCodex(codexConfig({}))).toBeInstanceOf(Codex);
  });
});
