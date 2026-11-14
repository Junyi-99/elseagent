import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import type { MigrationMeta } from "drizzle-orm/migrator";
import { journal, migrationFiles } from "./migrations.gen.ts";

const BREAKPOINT = "--> statement-breakpoint";

/**
 * The migrations in drizzle/, built the same way drizzle-orm's `readMigrationFiles` does, but
 * from SQL embedded at build time instead of read from disk.
 */
export function embeddedMigrations(): MigrationMeta[] {
  return journal.entries.map((entry) => {
    const query = migrationFiles[entry.tag];
    if (query === undefined) {
      throw new Error(`Migration ${entry.tag} is not embedded; run \`bun run db:generate\``);
    }
    return {
      sql: query.split(BREAKPOINT),
      bps: entry.breakpoints,
      folderMillis: entry.when,
      hash: new Bun.CryptoHasher("sha256").update(query).digest("hex"),
    };
  });
}

/**
 * Apply pending migrations. Same as drizzle-orm/bun-sqlite's `migrate`, which only adds
 * reading the files from a folder; the bookkeeping (`__drizzle_migrations`) is Drizzle's own.
 */
export function runMigrations<S extends Record<string, unknown>>(db: BunSQLiteDatabase<S>): void {
  // `dialect` and `session` are marked internal, but are exactly what Drizzle's migrate() uses.
  const { dialect, session } = db as unknown as {
    dialect: { migrate(m: MigrationMeta[], s: unknown, c: { migrationsFolder: string }): void };
    session: unknown;
  };
  dialect.migrate(embeddedMigrations(), session, { migrationsFolder: "(embedded)" });
}
