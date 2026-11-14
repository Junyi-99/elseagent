import { mkdir, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Command } from "commander";
import pkg from "../package.json";
import { startApp } from "./app.ts";
import { CONFIG_TEMPLATE, DEFAULT_CONFIG_PATH, loadConfig } from "./config/index.ts";

export function buildProgram(): Command {
  const program = new Command()
    .name("elseagent")
    .description("Codex agent for Slack")
    .version(pkg.version ?? "0.0.0");

  program
    .command("run")
    .description("start the agent")
    .option("-c, --config <path>", "path to config file", DEFAULT_CONFIG_PATH)
    .option(
      "--dry-run",
      "validate config, codex and working directory, then exit without connecting",
    )
    .argument("[working-directory]", "directory the agent works in (default: current directory)")
    .action(
      async (
        workingDirectoryArg: string | undefined,
        opts: { config: string; dryRun?: boolean },
      ) => {
        const workingDirectory = resolve(workingDirectoryArg ?? process.cwd());
        const isDir = await stat(workingDirectory).then(
          (s) => s.isDirectory(),
          () => false,
        );
        if (!isDir) {
          program.error(
            `error: working directory not found or not a directory: ${workingDirectory}`,
          );
        }
        const configPath = resolve(opts.config);
        const config = await loadConfig(configPath);
        await startApp(config, { configPath, workingDirectory, dryRun: opts.dryRun });
      },
    );

  program
    .command("init")
    .description("generate a minimal config.yaml")
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
      console.log(`  elseagent run -c ${out} [working-directory]`);
    });

  return program;
}
