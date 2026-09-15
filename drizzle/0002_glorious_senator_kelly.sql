ALTER TABLE `favorites` ADD CONSTRAINT `favorites_user_product_unique` UNIQUE(`userId`,`productId`);--> statement-breakpoint
CREATE INDEX `addresses_user_idx` ON `addresses` (`userId`);--> statement-breakpoint
CREATE INDEX `reviews_product_idx` ON `reviews` (`productId`);--> statement-breakpoint
CREATE INDEX `reviews_user_idx` ON `reviews` (`userId`);