import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONFIG_TEMPLATE } from "./config.ts";

const entry = join(import.meta.dir, "index.ts");

function run(args: string[], cwd: string) {
  const proc = Bun.spawnSync(["bun", entry, ...args], { cwd });
  return { code: proc.exitCode, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() };
}

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "elseagents-cli-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("cli", () => {
  test("init writes config.yaml in cwd", async () => {
    const res = run(["init"], dir);
    expect(res.code).toBe(0);
    expect(await Bun.file(join(dir, "config.yaml")).text()).toBe(CONFIG_TEMPLATE);
  });

  test("init refuses to overwrite without --force", () => {
    const res = run(["init"], dir);
    expect(res.code).not.toBe(0);
    expect(res.stderr).toContain("already exists");
    expect(run(["init", "--force"], dir).code).toBe(0);
  });

  test("init -o creates parent directories", async () => {
    const out = join(dir, "nested", "a", "conf.yaml");
    expect(run(["init", "-o", out], dir).code).toBe(0);
    expect(await Bun.file(out).exists()).toBe(true);
  });

  test("run with -c reports validation errors", () => {
    const res = run(["-c", "config.yaml"], dir);
    expect(res.code).toBe(1);
    expect(res.stderr).toContain("slack.botToken is required");
  });

  test("run with a missing config points to init", () => {
    const res = run(["-c", "missing.yaml"], dir);
    expect(res.code).toBe(1);
    expect(res.stderr).toContain("elseagents init");
  });

  test("run with a valid config starts", async () => {
    await Bun.write(join(dir, "ok.yaml"), "slack:\n  botToken: a\n  appToken: b\n");
    const res = run(["-c", "ok.yaml"], dir);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain(join(dir, "ok.yaml"));
  });
});
