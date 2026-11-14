CREATE TABLE `queue` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`conversation_key` text NOT NULL,
	`channel` text NOT NULL,
	`ts` text NOT NULL,
	`thread_ts` text,
	`user` text NOT NULL,
	`text` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `queue_status` ON `queue` (`status`,`id`);--> statement-breakpoint
CREATE INDEX `queue_conversation` ON `queue` (`conversation_key`,`status`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`conversation_key` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`last_active_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sessions_last_active` ON `sessions` (`last_active_at`);