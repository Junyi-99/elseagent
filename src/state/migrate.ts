import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import type { MigrationMeta } from "drizzle-orm/migrator";
import { migrations } from "./migrations.macro.ts" with { type: "macro" };

/** The migrations in drizzle/, embedded at build time (see migrations.macro.ts). */
export const EMBEDDED_MIGRATIONS: MigrationMeta[] = migrations();

/**
 * Apply pending migrations. Same as drizzle-orm/bun-sqlite's `migrate`, minus reading the
 * files at runtime; the bookkeeping (`__drizzle_migrations`) is Drizzle's own.
 */
export function runMigrations<S extends Record<string, unknown>>(db: BunSQLiteDatabase<S>): void {
  // `dialect` and `session` are marked internal, but are exactly what Drizzle's migrate() uses.
  const { dialect, session } = db as unknown as {
    dialect: { migrate(m: MigrationMeta[], s: unknown, c: { migrationsFolder: string }): void };
    session: unknown;
  };
  dialect.migrate(EMBEDDED_MIGRATIONS, session, { migrationsFolder: "(embedded)" });
}
