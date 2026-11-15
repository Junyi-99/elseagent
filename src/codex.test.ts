import { describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AGENT_INSTRUCTIONS } from "./agent/instructions.ts";
import {
  AGENT_THREAD_DEFAULTS,
  buildCodexOptions,
  buildThreadOptions,
  resolveCodexPath,
} from "./codex.ts";
import { ConfigError } from "./config/index.ts";

describe("resolveCodexPath", () => {
  test("uses codex.path when it resolves", () => {
    expect(resolveCodexPath({ path: "true" })).toBe(Bun.which("true") as string);
  });

  test("rejects a codex.path that does not exist", () => {
    expect(() => resolveCodexPath({ path: "/nope/codex" })).toThrow(ConfigError);
  });

  test("finds codex on PATH when codex.path is not set", async () => {
    const bin = await mkdtemp(join(tmpdir(), "elseagent-bin-"));
    try {
      await Bun.write(join(bin, "codex"), "#!/bin/sh\n");
      await chmod(join(bin, "codex"), 0o755);
      expect(resolveCodexPath({}, bin)).toBe(join(bin, "codex"));
    } finally {
      await rm(bin, { recursive: true, force: true });
    }
  });

  test("errors when codex is not on PATH", () => {
    expect(() => resolveCodexPath({}, "/nonexistent")).toThrow("Could not find `codex` on PATH");
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

  test("a container deployment can turn off Codex's own sandbox", () => {
    expect(buildThreadOptions({ sandboxMode: "danger-full-access" }, "/work").sandboxMode).toBe(
      "danger-full-access",
    );
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
  test("sends the agent instructions, then the channel's, then the agent prompt", () => {
    const opts = buildCodexOptions({
      codexPath: "/bin/codex",
      channelInstructions: "This is Telegram.",
      prompt: "You are a reviewer.",
    });
    expect(opts.codexPathOverride).toBe("/bin/codex");
    expect(opts.config?.developer_instructions).toBe(
      `${AGENT_INSTRUCTIONS}\n\n# This chat\n\nThis is Telegram.\n\n# Your role\n\nYou are a reviewer.`,
    );
  });

  test("without a channel or prompt only the agent instructions are sent", () => {
    expect(buildCodexOptions({ codexPath: "/bin/codex" }).config).toEqual({
      developer_instructions: AGENT_INSTRUCTIONS,
      features: { plugins: false, apps: false },
    });
  });
});

describe("MCP registration", () => {
  test("registers the elseagent server with the turn id, token via env, auto-approved", () => {
    const opts = buildCodexOptions({
      codexPath: "/bin/codex",
      mcp: { url: "http://127.0.0.1:1234/mcp", token: "secret", turnId: 42 },
    });
    expect(opts.config?.mcp_servers).toEqual({
      elseagent: {
        url: "http://127.0.0.1:1234/mcp",
        bearer_token_env_var: "ELSEAGENT_MCP_TOKEN",
        http_headers: { "x-elseagent-turn": "42" },
        default_tools_approval_mode: "approve",
      },
    });
    expect(opts.env?.ELSEAGENT_MCP_TOKEN).toBe("secret");
    expect(opts.env?.PATH).toBe(process.env.PATH as string);
    expect(opts.config?.shell_environment_policy).toEqual({ exclude: ["ELSEAGENT_MCP_TOKEN"] });
    expect(JSON.stringify(opts.config)).not.toContain("secret");
  });
});

test("ChatGPT apps and Codex plugins are always off", () => {
  const opts = buildCodexOptions({
    codexPath: "/bin/codex",
    mcp: { url: "http://127.0.0.1:1/mcp", token: "t", turnId: 1 },
  });
  expect(opts.config?.features).toEqual({ plugins: false, apps: false });
});

describe("config env", () => {
  test("is set explicitly in the environment of the commands Codex runs", () => {
    const opts = buildCodexOptions({
      codexPath: "/bin/codex",
      shellEnv: { GH_TOKEN: "ghp_x", CLOUDFLARE_API_TOKEN: "cf" },
      mcp: { url: "http://127.0.0.1:1/mcp", token: "secret", turnId: 1 },
    });
    expect(opts.config?.shell_environment_policy).toEqual({
      set: { GH_TOKEN: "ghp_x", CLOUDFLARE_API_TOKEN: "cf" },
      // The MCP token is kept out of the commands' environment.
      exclude: ["ELSEAGENT_MCP_TOKEN"],
    });
    expect(JSON.stringify(opts.config?.shell_environment_policy)).not.toContain("secret");
  });

  test("leaves Codex's policy alone when there is nothing to set", () => {
    expect(buildCodexOptions({ codexPath: "/bin/codex" }).config).not.toHaveProperty(
      "shell_environment_policy",
    );
  });
});
