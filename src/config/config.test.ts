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
    expect(config.slack).toEqual({ botToken: "xoxb-1", appToken: "xapp-1" });
    expect(config.codex.sandboxMode).toBe("workspace-write");
    expect(config.codex.approvalPolicy).toBe("never");
    expect(config.codex.skipGitRepoCheck).toBe(false);
  });

  test("rejects the unfilled template with a clear message", async () => {
    const path = await writeConfig("template.yaml", CONFIG_TEMPLATE);
    const err = await loadConfig(path).catch((e) => e);
    expect(err).toBeInstanceOf(ConfigError);
    expect(err.message).toContain("slack.botToken is required");
    expect(err.message).toContain("slack.appToken is required");
  });

  test("applies codex defaults when the section is missing", async () => {
    const path = await writeConfig("min.yaml", "slack:\n  botToken: a\n  appToken: b\n");
    const config = await loadConfig(path);
    expect(config.codex.sandboxMode).toBe("workspace-write");
  });

  test("resolves a relative workingDirectory against the config file", async () => {
    const path = await writeConfig(
      "rel.yaml",
      "slack:\n  botToken: a\n  appToken: b\ncodex:\n  workingDirectory: ./work\n",
    );
    const config = await loadConfig(path);
    expect(config.codex.workingDirectory).toBe(join(dir, "work"));
  });

  test("rejects invalid enum values", async () => {
    const path = await writeConfig(
      "bad.yaml",
      "slack:\n  botToken: a\n  appToken: b\ncodex:\n  sandboxMode: yolo\n",
    );
    expect(loadConfig(path)).rejects.toThrow("sandboxMode");
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

  test("covers every top-level section of the schema", () => {
    const parsed = Bun.YAML.parse(CONFIG_TEMPLATE) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(Object.keys(configSchema.shape).sort());
  });
});
