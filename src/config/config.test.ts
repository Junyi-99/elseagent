import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CONFIG_TEMPLATE,
  ConfigError,
  configSchema,
  DEFAULT_CONFIG_PATH,
  loadConfig,
} from "./index.ts";

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "elseagents-config-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function writeConfig(name: string, content: string): Promise<string> {
  const path = join(dir, name);
  await Bun.write(path, content);
  return path;
}

describe("loadConfig", () => {
  test("loads the template once tokens are filled in", async () => {
    const filled = CONFIG_TEMPLATE.replace('botToken: ""', "botToken: xoxb-1").replace(
      'appToken: ""',
      "appToken: xapp-1",
    );
    const config = await loadConfig(await writeConfig("filled.yaml", filled));
    expect(config.slack).toEqual({ botToken: "xoxb-1", appToken: "xapp-1", channels: [] });
    expect(config.codex).toEqual({});
  });

  test("rejects the unfilled template with a clear message", async () => {
    const path = await writeConfig("template.yaml", CONFIG_TEMPLATE);
    const err = await loadConfig(path).catch((e) => e);
    expect(err).toBeInstanceOf(ConfigError);
    expect(err.message).toContain("slack.botToken is required");
    expect(err.message).toContain("slack.appToken is required");
  });

  test("agent.prompt: multi-line is kept, empty means no prompt", async () => {
    const base = "slack:\n  botToken: a\n  appToken: b\n";
    const multi = await writeConfig(
      "prompt.yaml",
      `agent:\n  prompt: |\n    Line one.\n    Line two.\n${base}`,
    );
    expect((await loadConfig(multi)).agent.prompt).toBe("Line one.\nLine two.");
    const empty = await writeConfig("empty-prompt.yaml", `agent:\n  prompt: "  "\n${base}`);
    expect((await loadConfig(empty)).agent.prompt).toBeUndefined();
  });

  test("agent limits default and can be overridden", async () => {
    const base = "slack:\n  botToken: a\n  appToken: b\n";
    const defaults = await loadConfig(await writeConfig("limits-default.yaml", base));
    expect(defaults.agent).toEqual({
      maxConcurrent: 16,
      maxQueue: 100,
      turnTimeoutMinutes: 30,
      sessionIdleDays: 7,
    });
    const custom = await writeConfig(
      "limits.yaml",
      `agent:\n  maxConcurrent: 4\n  sessionIdleDays: 1\n${base}`,
    );
    expect((await loadConfig(custom)).agent).toMatchObject({
      maxConcurrent: 4,
      sessionIdleDays: 1,
    });
  });

  test("rejects non-positive or fractional limits", async () => {
    const base = "slack:\n  botToken: a\n  appToken: b\n";
    const zero = await writeConfig("zero.yaml", `agent:\n  maxConcurrent: 0\n${base}`);
    expect(loadConfig(zero)).rejects.toThrow("agent.maxConcurrent must be greater than 0");
    const frac = await writeConfig("frac.yaml", `agent:\n  sessionIdleDays: 1.5\n${base}`);
    expect(loadConfig(frac)).rejects.toThrow("agent.sessionIdleDays must be a whole number");
  });

  test("codex section is optional", async () => {
    const path = await writeConfig("min.yaml", "slack:\n  botToken: a\n  appToken: b\n");
    expect((await loadConfig(path)).codex).toEqual({});
  });

  test("accepts model and reasoningEffort overrides", async () => {
    const path = await writeConfig(
      "override.yaml",
      "codex:\n  model: my-model\n  reasoningEffort: high\nslack:\n  botToken: a\n  appToken: b\n",
    );
    expect((await loadConfig(path)).codex).toEqual({ model: "my-model", reasoningEffort: "high" });
  });

  test("resolves a relative codex.path against the config file", async () => {
    const path = await writeConfig(
      "rel.yaml",
      "codex:\n  path: ./bin/codex\nslack:\n  botToken: a\n  appToken: b\n",
    );
    expect((await loadConfig(path)).codex.path).toBe(join(dir, "bin/codex"));
  });

  test("rejects an invalid reasoningEffort", async () => {
    const path = await writeConfig(
      "bad.yaml",
      "codex:\n  reasoningEffort: extreme\nslack:\n  botToken: a\n  appToken: b\n",
    );
    expect(loadConfig(path)).rejects.toThrow("reasoningEffort");
  });

  test("reports a missing file", async () => {
    expect(loadConfig(join(dir, "nope.yaml"))).rejects.toThrow("Config file not found");
  });

  test("reports malformed YAML", async () => {
    const path = await writeConfig("broken.yaml", "slack: [unclosed\n");
    expect(loadConfig(path)).rejects.toThrow("Failed to parse");
  });
});

describe("config.example.yaml", () => {
  test("is the template written by `elseagents init`", async () => {
    const example = await Bun.file(join(import.meta.dir, "../../config.example.yaml")).text();
    expect(CONFIG_TEMPLATE).toBe(example);
  });

  test("documents the default config path", () => {
    expect(CONFIG_TEMPLATE).toContain(DEFAULT_CONFIG_PATH);
  });

  test("lists every top-level section of the schema, in order", () => {
    const parsed = Bun.YAML.parse(CONFIG_TEMPLATE) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual(Object.keys(configSchema.shape));
  });
});
