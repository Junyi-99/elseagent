ALTER TABLE `queue` ADD `mode` text DEFAULT 'direct' NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `muted` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `last_addressed_at` integer;--> statement-breakpoint
ALTER TABLE `sessions` ADD `unanswered` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `replied_to` text;