#!/usr/bin/env bun
import { buildProgram } from "./cli.ts";
import { ConfigError } from "./config/index.ts";

try {
  await buildProgram().parseAsync(process.argv);
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(`error: ${err.message}`);
    process.exit(1);
  }
  throw err;
}
