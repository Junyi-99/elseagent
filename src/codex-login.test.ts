import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codexAuthStatus, ensureCodexLogin } from "./codex-login.ts";

let dir: string;
/**
 * A fake `codex`: `login status` succeeds once $STATE/logged-in exists; `login --device-auth`
 * prints colored instructions and succeeds on attempt number $SUCCEED_ON (counting in $STATE).
 */
let fakeCodex: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "elseagent-login-"));
  fakeCodex = join(dir, "codex");
  await Bun.write(
    fakeCodex,
    `#!/bin/sh
if [ "$2" = "status" ]; then [ -f "$STATE/logged-in" ] && exit 0; echo "Not logged in"; exit 1; fi
n=$(cat "$STATE/attempts" 2>/dev/null || echo 0); n=$((n + 1)); echo $n > "$STATE/attempts"
printf '1. Open \\033[94mhttps://auth.openai.com/codex/device\\033[0m\\n2. Enter \\033[94mCODE-%s\\033[0m\\n' "$n"
if [ "$n" -ge "$SUCCEED_ON" ]; then touch "$STATE/logged-in"; exit 0; fi
echo "code expired" >&2; exit 1
`,
  );
  await chmod(fakeCodex, 0o755);
});
afterAll(() => rm(dir, { recursive: true, force: true }));

async function stateDir() {
  return mkdtemp(join(dir, "state-"));
}

describe("codex login", () => {
  test("an API key needs no login", async () => {
    expect(await codexAuthStatus(fakeCodex, { CODEX_API_KEY: "sk-x" })).toBe("api-key");
  });

  test("reports an existing login", async () => {
    const STATE = await stateDir();
    await Bun.write(join(STATE, "logged-in"), "");
    const lines: string[] = [];
    expect(
      await ensureCodexLogin({ codexPath: fakeCodex, env: { STATE }, log: (l) => lines.push(l) }),
    ).toBe("logged-in");
    expect(lines).toEqual([]); // nothing to do
  });

  test("runs device-code login, logs the link and code without colors, retries expired codes", async () => {
    const STATE = await stateDir();
    const lines: string[] = [];
    const auth = await ensureCodexLogin({
      codexPath: fakeCodex,
      env: { STATE, SUCCEED_ON: "2" },
      log: (l) => lines.push(l),
    });
    expect(auth).toBe("logged-in");
    expect(lines).toContain("  1. Open https://auth.openai.com/codex/device");
    expect(lines).toContain("  2. Enter CODE-1");
    expect(lines).toContain("codex: login code expired or failed; starting a new one");
    expect(lines).toContain("  2. Enter CODE-2");
    expect(lines.at(-1)).toBe("codex: logged in");
    expect(lines.join("\n")).not.toContain("\u001b[");
  });

  test("gives up after maxAttempts", async () => {
    const STATE = await stateDir();
    expect(
      ensureCodexLogin({
        codexPath: fakeCodex,
        env: { STATE, SUCCEED_ON: "9" },
        log: () => {},
        maxAttempts: 2,
      }),
    ).rejects.toThrow("did not complete after 2 attempts");
  });
});
