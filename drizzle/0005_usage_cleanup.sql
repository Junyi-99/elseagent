CREATE TABLE `codex_threads` (
	`thread_id` text PRIMARY KEY NOT NULL,
	`conversation_key` text NOT NULL,
	`last_used_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `codex_threads_last_used` ON `codex_threads` (`last_used_at`);--> statement-breakpoint
CREATE TABLE `usage` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` integer NOT NULL,
	`conversation_key` text NOT NULL,
	`channel` text NOT NULL,
	`user` text NOT NULL,
	`schedule_id` integer,
	`thread_id` text,
	`input_tokens` integer NOT NULL,
	`cached_input_tokens` integer NOT NULL,
	`output_tokens` integer NOT NULL,
	`reasoning_output_tokens` integer NOT NULL,
	`duration_ms` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `usage_at` ON `usage` (`at`);--> statement-breakpoint
INSERT OR IGNORE INTO `codex_threads` (`thread_id`, `conversation_key`, `last_used_at`) SELECT `thread_id`, `conversation_key`, `last_active_at` FROM `sessions` WHERE `thread_id` != '';
