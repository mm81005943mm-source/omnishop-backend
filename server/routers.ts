import { z } from "zod";
import { eq } from "drizzle-orm";
import { COOKIE_NAME } from "../shared/const.js";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { adminProcedure, protectedProcedure, publicProcedure, router } from "./_core/trpc";
import * as db from "./db";
import { storagePut } from "./storage";

const productInput = z.object({
  name: z.string().min(1).max(255),
  description: z.string().min(1),
  category: z.string().min(1).max(100),
  imageUrl: z.string().url().optional().nullable(),
  price: z.number().nonnegative(),
  oldPrice: z.number().nonnegative().optional().nullable(),
  stock: z.number().int().nonnegative(),
  isActive: z.boolean().default(true),
});

const orderItemInput = z.object({
  productId: z.number().int().positive(),
  quantity: z.number().int().positive(),
});

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  products: router({
    list: publicProcedure
      .input(
        z.object({
          includeInactive: z.boolean().default(false),
          query: z.string().optional(),
          category: z.string().optional(),
          minPrice: z.number().nonnegative().optional(),
          maxPrice: z.number().nonnegative().optional(),
          sort: z.enum(["newest", "price_asc", "price_desc"]).default("newest"),
        }).optional(),
      )
      .query(({ input }) => db.listProducts(input ?? {})),
    create: adminProcedure
      .input(productInput)
      .mutation(async ({ input }) => {
        const connection = await db.getDb();
        if (!connection) throw new Error("Database is not configured");
        const row = await connection
          .insert(db.products)
          .values({
            ...input,
            price: input.price.toFixed(2),
            oldPrice: input.oldPrice?.toFixed(2) ?? null,
            isActive: input.isActive ? 1 : 0,
          })
          .$returningId();
        return row[0];
      }),
    update: adminProcedure
      .input(productInput.extend({ id: z.number().int().positive() }))
      .mutation(async ({ input }) => {
        const connection = await db.getDb();
        if (!connection) throw new Error("Database is not configured");
        const { id, ...data } = input;
        await connection
          .update(db.products)
          .set({
            ...data,
            price: data.price.toFixed(2),
            oldPrice: data.oldPrice?.toFixed(2) ?? null,
            isActive: data.isActive ? 1 : 0,
          })
          .where(eq(db.products.id, id));
        return { id };
      }),
    delete: adminProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input }) => {
        const connection = await db.getDb();
        if (!connection) throw new Error("Database is not configured");
        await connection
          .update(db.products)
          .set({ isActive: 0 })
          .where(eq(db.products.id, input.id));
        return { success: true };
      }),
  }),
  orders: router({
    mine: protectedProcedure.query(({ ctx }) =>
      db.listUserOrders(ctx.user.id),
    ),
    create: protectedProcedure
      .input(
        z.object({
          items: z.array(orderItemInput).min(1),
          addressId: z.number().int().positive().optional(),
          couponCode: z.string().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const idempotencyKey = `${ctx.user.id}-${Date.now()}-${Math.random()}`;
        return db.createOrder({
          userId: ctx.user.id,
          items: input.items,
          addressId: input.addressId,
          couponCode: input.couponCode,
          idempotencyKey,
        });
      }),
    list: adminProcedure.query(() => db.listAllOrders()),
    updateStatus: adminProcedure
      .input(
        z.object({
          orderId: z.number().int().positive(),
          status: z.enum(["pending", "processing", "shipped", "delivered", "cancelled"]),
        }),
      )
      .mutation(async ({ input }) =>
        db.updateOrderStatus(input.orderId, input.status),
      ),
  }),
  admin: router({
    stats: adminProcedure.query(() => db.getAdminStats()),
  }),
  media: router({
    uploadProductImage: adminProcedure
      .input(
        z.object({
          fileName: z.string().regex(/^[a-zA-Z0-9._-]+$/),
          contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
          base64: z.string(),
        }),
      )
      .mutation(async ({ input }) => {
        const buffer = Buffer.from(input.base64, "base64");
        const result = await storagePut(
          `products/${Date.now()}-${input.fileName}`,
          buffer,
          input.contentType,
        );
        return result;
      }),
  }),
  addresses: router({
    list: protectedProcedure.query(({ ctx }) =>
      db.listAddresses(ctx.user.id),
    ),
    create: protectedProcedure
      .input(
        z.object({
          label: z.string().min(1).max(100),
          line1: z.string().min(1).max(255),
          city: z.string().min(1).max(100),
          country: z.string().min(1).max(100),
          isDefault: z.boolean().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) =>
        db.addAddress(ctx.user.id, input),
      ),
  }),
  favorites: router({
    list: protectedProcedure.query(({ ctx }) =>
      db.listFavorites(ctx.user.id),
    ),
    toggle: protectedProcedure
      .input(z.object({ productId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) =>
        db.toggleFavorite(ctx.user.id, input.productId),
      ),
  }),
  reviews: router({
    list: publicProcedure
      .input(z.object({ productId: z.number().int().positive() }))
      .query(({ input }) => db.listReviews(input.productId)),
    create: protectedProcedure
      .input(
        z.object({
          productId: z.number().int().positive(),
          rating: z.number().int().min(1).max(5),
          body: z.string().max(1000).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) =>
        db.addReview(ctx.user.id, input),
      ),
  }),
  coupons: router({
    create: adminProcedure
      .input(
        z.object({
          code: z.string().min(3).max(64),
          percentOff: z.number().int().min(1).max(100),
          minimumOrder: z.number().nonnegative().default(0),
          usageLimit: z.number().int().positive().optional(),
          maxDiscount: z.number().nonnegative().optional(),
        }),
      )
      .mutation(async ({ input }) => {
        const connection = await db.getDb();
        if (!connection) throw new Error("Database is not configured");
        return connection
          .insert(db.coupons)
          .values({
            code: input.code.toUpperCase(),
            percentOff: input.percentOff,
            minimumOrder: input.minimumOrder,
            usageLimit: input.usageLimit ?? null,
            maxDiscount: input.maxDiscount ?? null,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .$returningId();
      }),
  }),
});

export type AppRouter = typeof appRouter;
