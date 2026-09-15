import { z } from "zod";
import { eq } from "drizzle-orm";
import { COOKIE_NAME } from "../shared/const.js";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { adminProcedure, protectedProcedure, publicProcedure, router } from "./_core/trpc";
import * as db from "./db";
import { storagePut } from "./storage";

const productInput = z.object({ name: z.string().min(1).max(255), description: z.string().min(1), category: z.string().min(1).max(100), imageUrl: z.string().url().optional().nullable(), price: z.number().nonnegative(), oldPrice: z.number().nonnegative().optional().nullable(), stock: z.number().int().nonnegative(), isActive: z.boolean().default(true) });
const orderItemInput = z.object({ productId: z.number().int().positive(), quantity: z.number().int().positive() });

export const appRouter = router({
  system: systemRouter,
  auth: router({ me: publicProcedure.query((opts) => opts.ctx.user), logout: publicProcedure.mutation(({ ctx }) => { const cookieOptions = getSessionCookieOptions(ctx.req); ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 }); return { success: true } as const; }) }),
  products: router({
    list: publicProcedure.input(z.object({ includeInactive: z.boolean().default(false), query: z.string().optional(), category: z.string().optional(), minPrice: z.number().nonnegative().optional(), maxPrice: z.number().nonnegative().optional(), sort: z.enum(["newest", "price_asc", "price_desc"]).default("newest") }).optional()).query(({ input }) => db.listProducts(input ?? {})),
    create: adminProcedure.input(productInput).mutation(async ({ input }) => { const connection = await db.getDb(); if (!connection) throw new Error("Database is not configured"); const row = await connection.insert(db.products).values({ ...input, price: input.price.toFixed(2), oldPrice: input.oldPrice?.toFixed(2) ?? null, isActive: input.isActive ? 1 : 0 }).$returningId(); return row[0]; }),
    update: adminProcedure.input(productInput.extend({ id: z.number().int().positive() })).mutation(async ({ input }) => { const connection = await db.getDb(); if (!connection) throw new Error("Database is not configured"); const { id, ...data } = input; await connection.update(db.products).set({ ...data, price: data.price.toFixed(2), oldPrice: data.oldPrice?.toFixed(2) ?? null, isActive: data.isActive ? 1 : 0 }).where(eq(db.products.id, id)); return { id }; }),
    delete: adminProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ input }) => { const connection = await db.getDb(); if (!connection) throw new Error("Database is not configured"); await connection.update(db.products).set({ isActive: 0 }).where(eq(db.products.id, input.id)); return { success: true }; }),
  }),
  orders: router({ mine: protectedProcedure.query(({ ctx }) => db.listUserOrders(ctx.user.id)), create: protectedProcedure.input(z.object({ items: z.array(orderItemInput).min(1), addressId: z.number().int().positive().optional(), couponCode: z.string().max(64).optional(), idempotencyKey: z.string().min(16).max(128) })).mutation(({ ctx, input }) => db.createOrder({ userId: ctx.user.id, ...input })), all: adminProcedure.query(() => db.listAllOrders()), updateStatus: adminProcedure.input(z.object({ orderId: z.number().int().positive(), status: z.enum(["pending", "processing", "shipped", "delivered", "cancelled"]) })).mutation(({ input }) => db.updateOrderStatus(input.orderId, input.status)) }),
  admin: router({ stats: adminProcedure.query(() => db.getAdminStats()) }),
  media: router({ uploadProductImage: adminProcedure.input(z.object({ fileName: z.string().regex(/^[a-zA-Z0-9._-]+$/), contentType: z.enum(["image/jpeg", "image/png", "image/webp"]), base64: z.string().max(7_000_000) })).mutation(async ({ ctx, input }) => { void ctx; const data = Buffer.from(input.base64, "base64"); if (data.length > 5 * 1024 * 1024) throw new Error("Image is too large"); return storagePut(`products/${input.fileName}`, data, input.contentType); }) }),
  addresses: router({ list: protectedProcedure.query(({ ctx }) => db.listAddresses(ctx.user.id)), create: protectedProcedure.input(z.object({ label: z.string().min(1).max(100), line1: z.string().min(1), city: z.string().min(1).max(120), country: z.string().min(1).max(120), isDefault: z.boolean().default(false) })).mutation(({ ctx, input }) => db.addAddress(ctx.user.id, input)) }),
  favorites: router({ list: protectedProcedure.query(({ ctx }) => db.listFavorites(ctx.user.id)), toggle: protectedProcedure.input(z.object({ productId: z.number().int().positive() })).mutation(({ ctx, input }) => db.toggleFavorite(ctx.user.id, input.productId)) }),
  reviews: router({ list: publicProcedure.input(z.object({ productId: z.number().int().positive() })).query(({ input }) => db.listReviews(input.productId)), create: protectedProcedure.input(z.object({ productId: z.number().int().positive(), rating: z.number().int().min(1).max(5), body: z.string().max(2000).optional() })).mutation(({ ctx, input }) => db.addReview(ctx.user.id, input)) }),
  coupons: router({ create: adminProcedure.input(z.object({ code: z.string().min(3).max(64), percentOff: z.number().int().min(1).max(100), minimumOrder: z.number().nonnegative().default(0), usageLimit: z.number().int().positive().optional(), startsAt: z.coerce.date(), expiresAt: z.coerce.date().optional() })).mutation(async ({ input }) => { const connection = await db.getDb(); if (!connection) throw new Error("Database is not configured"); const row = await connection.insert(db.coupons).values({ ...input, code: input.code.trim().toUpperCase(), minimumOrder: input.minimumOrder.toFixed(2), usageLimit: input.usageLimit ?? null, expiresAt: input.expiresAt ?? null }).$returningId(); return row[0]; }) }),
});
export type AppRouter = typeof appRouter;
