ALTER TABLE `orders` ADD `idempotencyKey` varchar(128) NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_idempotencyKey_unique` UNIQUE(`idempotencyKey`);