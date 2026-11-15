import { expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setupIntegrations, writeIntegrationFiles } from "./integrations.ts";

test("no integrations: no variables, no instructions", () => {
  expect(setupIntegrations({}, "/state")).toEqual({
    env: {},
    names: [],
    instructions: undefined,
    files: [],
  });
});

test("each integration sets the variables its tools read", () => {
  const setup = setupIntegrations(
    {
      github: { token: "ghp_x" },
      cloudflare: { apiToken: "cf", accountId: "acc" },
      kubernetes: { kubeconfig: "/etc/kube/config" },
    },
    "/state",
  );
  expect(setup.env).toEqual({
    GH_TOKEN: "ghp_x",
    CLOUDFLARE_API_TOKEN: "cf",
    CLOUDFLARE_ACCOUNT_ID: "acc",
    KUBECONFIG: "/etc/kube/config",
  });
  expect(setup.names).toEqual(["github", "cloudflare", "kubernetes"]);
  expect(setup.instructions).toContain("`gh` and `git`");
  expect(setup.instructions).toContain("`wrangler`");
  expect(setup.instructions).toContain("`kubectl`");
  expect(setup.instructions).not.toContain("ghp_x");
  expect(setup.files).toEqual([]);
});

test("an inline kubeconfig is written to the state directory, readable only by the agent", async () => {
  const dir = await mkdtemp(join(tmpdir(), "elseagent-int-"));
  try {
    const setup = setupIntegrations(
      { kubernetes: { kubeconfig: "apiVersion: v1\nkind: Config" } },
      dir,
    );
    expect(setup.env.KUBECONFIG).toBe(join(dir, "kubeconfig"));
    await writeIntegrationFiles(setup.files);
    expect(await Bun.file(join(dir, "kubeconfig")).text()).toBe("apiVersion: v1\nkind: Config\n");
    expect((await stat(join(dir, "kubeconfig"))).mode & 0o777).toBe(0o600);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
