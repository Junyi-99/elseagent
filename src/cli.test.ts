import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONFIG_TEMPLATE } from "./config/index.ts";

const entry = join(import.meta.dir, "index.ts");

/** Run the CLI with HOME pointed at the test directory, so ~/.elseagent.yaml is isolated. */
function run(args: string[], cwd: string) {
  const proc = Bun.spawnSync(["bun", entry, ...args], { cwd, env: { ...process.env, HOME: cwd } });
  return { code: proc.exitCode, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() };
}

let dir: string;
beforeAll(async () => {
  // realpath: on macOS the tmpdir is a symlink (/var -> /private/var) and the CLI prints real paths.
  dir = await realpath(await mkdtemp(join(tmpdir(), "elseagent-cli-")));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("cli", () => {
  test("without a command shows help listing run and init", () => {
    const res = run([], dir);
    const out = res.stdout + res.stderr;
    expect(out).toContain("Usage: elseagent");
    expect(out).toMatch(/run \[options\] \[working-directory\]/);
    expect(out).toMatch(/init \[options\]/);
  });

  test("init writes ~/.elseagent.yaml by default", async () => {
    const res = run(["init"], dir);
    expect(res.code).toBe(0);
    expect(await Bun.file(join(dir, ".elseagent.yaml")).text()).toBe(CONFIG_TEMPLATE);
    expect(res.stdout).toContain("elseagent run [working-directory]");
  });

  test("run reads ~/.elseagent.yaml by default", async () => {
    await Bun.write(join(dir, ".elseagent.yaml"), "slack:\n  botToken: a\n  appToken: b\n");
    const res = run(["run", "--dry-run"], dir);
    expect(res.code).toBe(0);
    expect(res.stdout).toMatch(new RegExp(`config: +${join(dir, ".elseagent.yaml")}\\n`));
    await Bun.write(join(dir, ".elseagent.yaml"), CONFIG_TEMPLATE);
  });

  test("-c and -o accept ~ paths", async () => {
    expect(run(["init", "-o", "~/sub/a.yaml"], dir).code).toBe(0);
    expect(await Bun.file(join(dir, "sub/a.yaml")).exists()).toBe(true);
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
    const res = run(["run"], dir);
    expect(res.code).toBe(1);
    expect(res.stderr).toContain("slack.botToken is still the placeholder");
  });

  test("run with a missing config points to init", () => {
    const res = run(["run", "-c", "missing.yaml"], dir);
    expect(res.code).toBe(1);
    expect(res.stderr).toContain("elseagent init");
  });

  test("run defaults the working directory to the current directory", async () => {
    await Bun.write(join(dir, "ok.yaml"), "slack:\n  botToken: a\n  appToken: b\n");
    const res = run(["run", "-c", "ok.yaml", "--dry-run"], dir);
    expect(res.code).toBe(0);
    expect(res.stdout).toMatch(new RegExp(`config: +${join(dir, "ok.yaml")}\\n`));
    expect(res.stdout).toMatch(new RegExp(`working directory: +${dir}\\n`));
  });

  test("run accepts a working directory argument", async () => {
    await mkdir(join(dir, "ws"), { recursive: true });
    const res = run(["run", "-c", "ok.yaml", "--dry-run", "ws"], dir);
    expect(res.code).toBe(0);
    expect(res.stdout).toMatch(new RegExp(`working directory: +${join(dir, "ws")}\\n`));
  });

  test("run rejects a working directory that is missing or not a directory", () => {
    const res = run(["run", "-c", "ok.yaml", "--dry-run", "does-not-exist"], dir);
    expect(res.code).not.toBe(0);
    expect(res.stderr).toContain("working directory not found or not a directory");
  });
});
