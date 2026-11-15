import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { downloadSlackFile } from "./files.ts";

const dest = () => join(mkdtempSync(join(tmpdir(), "elseagent-slack-")), "f");
const URL = "https://files.slack.com/files-pri/T1-F1/download/a.txt";

describe("downloadSlackFile", () => {
  test("fetches with the bot token and saves the file", async () => {
    const seen: [string, RequestInit][] = [];
    const path = dest();
    await downloadSlackFile(
      "xoxb-1",
      { name: "a.txt", ref: URL },
      path,
      undefined,
      async (u, i) => {
        seen.push([u, i]);
        return new Response("hello", { headers: { "content-type": "text/plain" } });
      },
    );
    expect(await Bun.file(path).text()).toBe("hello");
    expect(seen[0]?.[0]).toBe(URL);
    expect(seen[0]?.[1].headers).toEqual({ authorization: "Bearer xoxb-1" });
  });

  test("never sends the token outside Slack", async () => {
    let called = false;
    const fetchImpl = async () => {
      called = true;
      return new Response("x");
    };
    for (const ref of ["https://evil.example/a", "http://files.slack.com/a", "notaurl"]) {
      expect(
        downloadSlackFile("t", { name: "a", ref }, dest(), undefined, fetchImpl),
      ).rejects.toThrow("not a Slack file URL");
    }
    expect(called).toBe(false);
  });

  test("a sign-in page instead of the file points at the missing scope", async () => {
    const page = async () => new Response("<html>", { headers: { "content-type": "text/html" } });
    expect(
      downloadSlackFile("t", { name: "a.txt", ref: URL }, dest(), undefined, page),
    ).rejects.toThrow("files:read");
    const failed = async () => new Response("", { status: 404 });
    expect(
      downloadSlackFile("t", { name: "a.txt", ref: URL }, dest(), undefined, failed),
    ).rejects.toThrow("HTTP 404");
  });
});
