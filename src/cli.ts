import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Command } from "commander";
import pkg from "../package.json";
import { startApp } from "./app.ts";
import { CONFIG_TEMPLATE, DEFAULT_CONFIG_PATH, loadConfig } from "./config/index.ts";

export function buildProgram(): Command {
  const program = new Command()
    .name("elseagents")
    .description("Codex agent for Slack")
    .version(pkg.version ?? "0.0.0")
    .option("-c, --config <path>", "path to config file", DEFAULT_CONFIG_PATH)
    .action(async (opts: { config: string }) => {
      const configPath = resolve(opts.config);
      const config = await loadConfig(configPath);
      await startApp(config, configPath);
    });

  program
    .command("init")
    .description("generate a config.yaml template")
    .option("-o, --output <path>", "where to write the config", "config.yaml")
    .option("-f, --force", "overwrite an existing file", false)
    .action(async (opts: { output: string; force: boolean }) => {
      const out = resolve(opts.output);
      if (!opts.force && (await Bun.file(out).exists())) {
        program.error(`${out} already exists. Use --force to overwrite.`);
      }
      await mkdir(dirname(out), { recursive: true });
      await Bun.write(out, CONFIG_TEMPLATE);
      console.log(`Wrote ${out}`);
      console.log("Fill in slack.botToken and slack.appToken, then run:");
      console.log(`  elseagents -c ${out}`);
    });

  return program;
}
