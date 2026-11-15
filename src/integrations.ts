import { chmod, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { IntegrationsConfig } from "./config/index.ts";

/** What the `integrations` section turns into. */
export interface IntegrationSetup {
  /** Variables for the agent and every command Codex runs (GH_TOKEN, KUBECONFIG…). */
  env: Record<string, string>;
  /** Configured integrations, for the startup summary. */
  names: string[];
  /** What Codex is told about the tools it can use, or undefined when none are configured. */
  instructions: string | undefined;
  /** Files to write before starting (a kubeconfig given inline). */
  files: { path: string; content: string }[];
}

/**
 * Turn the configured integrations into the environment variables their tools read, so the
 * config can say `github: { token }` instead of naming variables. `stateDir` holds generated files.
 */
export function setupIntegrations(
  integrations: IntegrationsConfig,
  stateDir: string,
): IntegrationSetup {
  const env: Record<string, string> = {};
  const names: string[] = [];
  const notes: string[] = [];
  const files: IntegrationSetup["files"] = [];

  const { github, cloudflare, kubernetes } = integrations;
  if (github) {
    // gh reads GH_TOKEN; git over HTTPS uses gh as its credential helper (see the Dockerfile).
    env.GH_TOKEN = github.token;
    names.push("github");
    notes.push("GitHub: `gh` and `git` over HTTPS (github.com) are signed in.");
  }
  if (cloudflare) {
    env.CLOUDFLARE_API_TOKEN = cloudflare.apiToken;
    if (cloudflare.accountId) env.CLOUDFLARE_ACCOUNT_ID = cloudflare.accountId;
    names.push("cloudflare");
    notes.push("Cloudflare: `wrangler` is signed in.");
  }
  if (kubernetes) {
    const inline = kubernetes.kubeconfig.includes("\n");
    const path = inline ? join(stateDir, "kubeconfig") : kubernetes.kubeconfig;
    if (inline) files.push({ path, content: `${kubernetes.kubeconfig.trimEnd()}\n` });
    env.KUBECONFIG = path;
    names.push("kubernetes");
    notes.push("Kubernetes: `kubectl` and `helm` use the configured kubeconfig.");
  }

  const instructions =
    notes.length > 0
      ? `Credentials are set up for these tools; use them directly:\n${notes.map((n) => `- ${n}`).join("\n")}`
      : undefined;
  return { env, names, instructions, files };
}

/** Write the generated files, readable only by the agent (they hold credentials). */
export async function writeIntegrationFiles(files: IntegrationSetup["files"]): Promise<void> {
  for (const { path, content } of files) {
    await mkdir(join(path, ".."), { recursive: true });
    await Bun.write(path, content);
    await chmod(path, 0o600);
  }
}
