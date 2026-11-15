import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  CONFIG_TEMPLATE,
  ConfigError,
  configSections,
  DEFAULT_CONFIG_PATH,
  loadConfig,
  PLACEHOLDER,
} from "./index.ts";

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "elseagent-config-"));
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
    const filled = CONFIG_TEMPLATE.replace("xoxb-REPLACE-ME", "xoxb-1").replace(
      "xapp-REPLACE-ME",
      "xapp-1",
    );
    const config = await loadConfig(await writeConfig("filled.yaml", filled));
    expect(config.channels.slack).toEqual({ botToken: "xoxb-1", appToken: "xapp-1", join: [] });
    expect(config.agent.maxConcurrent).toBe(32);
    expect(config.codex).toEqual({});
  });

  test("rejects the unfilled template with a clear message", async () => {
    const path = await writeConfig("template.yaml", CONFIG_TEMPLATE);
    const err = await loadConfig(path).catch((e) => e);
    expect(err).toBeInstanceOf(ConfigError);
    expect(err.message).toContain("channels.slack.botToken is still the placeholder");
    expect(err.message).toContain("channels.slack.appToken is still the placeholder");
  });

  test("reports missing tokens and a missing channel", async () => {
    const empty = await writeConfig("empty-tokens.yaml", 'channels:\n  slack:\n    botToken: ""\n');
    const err = await loadConfig(empty).catch((e) => e);
    expect(err.message).toContain("channels.slack.botToken is required");
    expect(err.message).toContain("channels.slack.appToken is required");
    const none = await writeConfig("no-channel.yaml", "agent:\n  maxConcurrent: 2\n");
    expect(loadConfig(none)).rejects.toThrow("configure at least one channel");
    const emptySection = await writeConfig("empty-slack.yaml", "channels:\n  slack:\n");
    expect(loadConfig(emptySection)).rejects.toThrow("configure at least one channel");
  });

  test("telegram alone is enough; allowedUsers are kept as strings", async () => {
    const path = await writeConfig(
      "telegram.yaml",
      'channels:\n  telegram:\n    botToken: "123:abc"\n    allowedUsers: [42, "43"]\n',
    );
    const config = await loadConfig(path);
    expect(config.channels.slack).toBeUndefined();
    expect(config.channels.telegram).toEqual({ botToken: "123:abc", allowedUsers: ["42", "43"] });
    const bad = await writeConfig(
      "telegram-bad.yaml",
      "channels:\n  telegram:\n    botToken: x\n    allowedUsers: [alice]\n",
    );
    expect(loadConfig(bad)).rejects.toThrow("numeric Telegram user IDs");
  });

  test("slack and telegram together", async () => {
    const path = await writeConfig(
      "both.yaml",
      "channels:\n  slack:\n    botToken: a\n    appToken: b\n  telegram:\n    botToken: c\n",
    );
    const config = await loadConfig(path);
    expect(config.channels.slack?.botToken).toBe("a");
    expect(config.channels.telegram).toEqual({ botToken: "c", allowedUsers: [] });
  });

  test("agent.prompt: multi-line is kept, empty means no prompt", async () => {
    const base = "channels:\n  slack:\n    botToken: a\n    appToken: b\n";
    const multi = await writeConfig(
      "prompt.yaml",
      `agent:\n  prompt: |\n    Line one.\n    Line two.\n${base}`,
    );
    expect((await loadConfig(multi)).agent.prompt).toBe("Line one.\nLine two.");
    const empty = await writeConfig("empty-prompt.yaml", `agent:\n  prompt: "  "\n${base}`);
    expect((await loadConfig(empty)).agent.prompt).toBeUndefined();
  });

  test("agent limits default and can be overridden", async () => {
    const base = "channels:\n  slack:\n    botToken: a\n    appToken: b\n";
    const defaults = await loadConfig(await writeConfig("limits-default.yaml", base));
    expect(defaults.agent).toEqual({
      maxConcurrent: 32,
      maxQueue: 1024,
      turnTimeoutMinutes: 30,
      sessionIdleDays: 7,
      stateDir: join(homedir(), ".elseagent"),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
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
    const base = "channels:\n  slack:\n    botToken: a\n    appToken: b\n";
    const zero = await writeConfig("zero.yaml", `agent:\n  maxConcurrent: 0\n${base}`);
    expect(loadConfig(zero)).rejects.toThrow("agent.maxConcurrent must be greater than 0");
    const frac = await writeConfig("frac.yaml", `agent:\n  sessionIdleDays: 1.5\n${base}`);
    expect(loadConfig(frac)).rejects.toThrow("agent.sessionIdleDays must be a whole number");
  });

  test("agent.stateDir expands ~ and resolves relative paths against the config file", async () => {
    const base = "channels:\n  slack:\n    botToken: a\n    appToken: b\n";
    const home = await writeConfig("state-home.yaml", `agent:\n  stateDir: ~/agents/a\n${base}`);
    expect((await loadConfig(home)).agent.stateDir).toBe(join(homedir(), "agents/a"));
    const rel = await writeConfig("state-rel.yaml", `agent:\n  stateDir: ./state\n${base}`);
    expect((await loadConfig(rel)).agent.stateDir).toBe(join(dir, "state"));
  });

  test("env: variables as strings, empty when missing, names validated", async () => {
    const base = "channels:\n  slack:\n    botToken: a\n    appToken: b\n";
    expect((await loadConfig(await writeConfig("env-none.yaml", base))).env).toEqual({});
    const path = await writeConfig(
      "env.yaml",
      `${base}env:\n  GH_TOKEN: ghp_x\n  PORT: 8080\n  DEBUG: true\n`,
    );
    expect((await loadConfig(path)).env).toEqual({
      GH_TOKEN: "ghp_x",
      PORT: "8080",
      DEBUG: "true",
    });
    const bad = await writeConfig("env-bad.yaml", `${base}env:\n  "NOT-OK": x\n`);
    expect(loadConfig(bad)).rejects.toThrow("env names must be valid variable names");
  });

  test("codex section is optional", async () => {
    const path = await writeConfig(
      "min.yaml",
      "channels:\n  slack:\n    botToken: a\n    appToken: b\n",
    );
    expect((await loadConfig(path)).codex).toEqual({});
  });

  test("accepts model and reasoningEffort overrides", async () => {
    const path = await writeConfig(
      "override.yaml",
      "codex:\n  model: my-model\n  reasoningEffort: high\nchannels:\n  slack:\n    botToken: a\n    appToken: b\n",
    );
    expect((await loadConfig(path)).codex).toEqual({ model: "my-model", reasoningEffort: "high" });
  });

  test("resolves a relative codex.path against the config file", async () => {
    const path = await writeConfig(
      "rel.yaml",
      "codex:\n  path: ./bin/codex\nchannels:\n  slack:\n    botToken: a\n    appToken: b\n",
    );
    expect((await loadConfig(path)).codex.path).toBe(join(dir, "bin/codex"));
  });

  test("rejects an invalid reasoningEffort", async () => {
    const path = await writeConfig(
      "bad.yaml",
      "codex:\n  reasoningEffort: extreme\nchannels:\n  slack:\n    botToken: a\n    appToken: b\n",
    );
    expect(loadConfig(path)).rejects.toThrow("reasoningEffort");
  });

  test("reports a missing file", async () => {
    expect(loadConfig(join(dir, "nope.yaml"))).rejects.toThrow("Config file not found");
  });

  test("reports malformed YAML", async () => {
    const path = await writeConfig("broken.yaml", "channels: [unclosed\n");
    expect(loadConfig(path)).rejects.toThrow("Failed to parse");
  });
});

describe("config.example.yaml", () => {
  test("is the template written by `elseagent init`", async () => {
    const example = await Bun.file(join(import.meta.dir, "../../config.example.yaml")).text();
    expect(CONFIG_TEMPLATE).toBe(example);
  });

  test("documents the default config path", () => {
    expect(CONFIG_TEMPLATE).toContain(DEFAULT_CONFIG_PATH);
  });

  test("has no commented-out options or empty values, only real settings", () => {
    const lines = CONFIG_TEMPLATE.split("\n").filter((l) => l.trim());
    const firstSetting = lines.findIndex((l) => !l.startsWith("#"));
    // Comments only in the header; every line after it is an active setting.
    expect(lines.slice(firstSetting).some((l) => l.trim().startsWith("#"))).toBe(false);
    expect(CONFIG_TEMPLATE).not.toMatch(/:\s*(""|''|~|null)\s*$/m);
  });

  test("contains only required settings, as placeholders", () => {
    expect(Bun.YAML.parse(CONFIG_TEMPLATE)).toEqual({
      channels: { slack: { botToken: `xoxb-${PLACEHOLDER}`, appToken: `xapp-${PLACEHOLDER}` } },
    });
  });
});

describe("docs/config.md", () => {
  test("documents every option of every section", async () => {
    const docs = await Bun.file(join(import.meta.dir, "../../docs/config.md")).text();
    const missing = Object.entries(configSections).flatMap(([section, schema]) =>
      Object.keys(schema.shape)
        .map((key) => `${section}.${key}`)
        .filter((option) => !docs.includes(`\`${option}\``)),
    );
    expect(missing).toEqual([]);
  });
});
