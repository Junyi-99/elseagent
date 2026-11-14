import { describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Codex } from "@openai/codex-sdk";
import { SLACK_INSTRUCTIONS } from "./agent/instructions.ts";
import {
  AGENT_THREAD_DEFAULTS,
  buildCodexOptions,
  buildThreadOptions,
  createCodex,
} from "./codex.ts";
import { ConfigError } from "./config/index.ts";

describe("createCodex", () => {
  test("uses codex.path when it resolves", () => {
    expect(createCodex({ path: "true" })).toBeInstanceOf(Codex);
  });

  test("rejects a codex.path that does not exist", () => {
    expect(() => createCodex({ path: "/nope/codex" })).toThrow(ConfigError);
  });

  test("finds codex on PATH when codex.path is not set", async () => {
    const bin = await mkdtemp(join(tmpdir(), "elseagent-bin-"));
    try {
      await Bun.write(join(bin, "codex"), "#!/bin/sh\n");
      await chmod(join(bin, "codex"), 0o755);
      expect(createCodex({}, undefined, bin)).toBeInstanceOf(Codex);
    } finally {
      await rm(bin, { recursive: true, force: true });
    }
  });

  test("errors when codex is not on PATH", () => {
    expect(() => createCodex({}, undefined, "/nonexistent")).toThrow(
      "Could not find `codex` on PATH",
    );
  });
});

describe("buildThreadOptions", () => {
  test("runs in agent mode in the given working directory", () => {
    expect(buildThreadOptions({}, "/work")).toEqual({
      sandboxMode: "workspace-write",
      approvalPolicy: "never",
      skipGitRepoCheck: true,
      workingDirectory: "/work",
      model: undefined,
      modelReasoningEffort: undefined,
    });
  });

  test("passes model and reasoningEffort overrides through", () => {
    const opts = buildThreadOptions({ model: "m", reasoningEffort: "high" }, "/work");
    expect(opts).toMatchObject({
      ...AGENT_THREAD_DEFAULTS,
      model: "m",
      modelReasoningEffort: "high",
    });
  });
});

describe("buildCodexOptions", () => {
  test("sends the Slack instructions followed by the agent prompt", () => {
    const opts = buildCodexOptions("You are a reviewer.", "/bin/codex");
    expect(opts.codexPathOverride).toBe("/bin/codex");
    const instructions = String(opts.config?.developer_instructions);
    expect(instructions.startsWith(SLACK_INSTRUCTIONS)).toBe(true);
    expect(instructions.endsWith("# Your role\n\nYou are a reviewer.")).toBe(true);
  });

  test("without a prompt only the Slack instructions are sent", () => {
    expect(buildCodexOptions(undefined, "/bin/codex").config).toEqual({
      developer_instructions: SLACK_INSTRUCTIONS,
    });
  });
});
