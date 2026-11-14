// Bun macro: runs while bundling (`bun run`, `bun test`, `bun build --compile`), and the
// returned value is inlined into the importing module. The migrations in drizzle/ are thereby
// embedded in the single-file executable, read by Drizzle's own `readMigrationFiles`.
import { join } from "node:path";
import { type MigrationMeta, readMigrationFiles } from "drizzle-orm/migrator";

export function migrations(): MigrationMeta[] {
  return readMigrationFiles({ migrationsFolder: join(import.meta.dir, "../../drizzle") });
}
