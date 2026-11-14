CREATE TABLE `schedules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`cron` text NOT NULL,
	`timezone` text NOT NULL,
	`channel` text NOT NULL,
	`prompt` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`next_run_at` integer NOT NULL,
	`last_run_at` integer
);
--> statement-breakpoint
CREATE INDEX `schedules_next_run` ON `schedules` (`next_run_at`);--> statement-breakpoint
ALTER TABLE `queue` ADD `schedule_id` integer;