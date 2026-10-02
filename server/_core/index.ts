import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerUsernamePasswordAuth, registerOAuthRoutes, registerCommonAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { ENV } from "./env";

async function startServer() {
  const app = express();
  const server = createServer(app);
  const allowedOrigins = new Set(ENV.allowedOrigins);

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && allowedOrigins.has(origin)) {
      res.header("Access-Control-Allow-Origin", origin);
      res.header("Vary", "Origin");
      res.header("Access-Control-Allow-Credentials", "true");
    }
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
    if (req.method === "OPTIONS") {
      if (origin && !allowedOrigins.has(origin)) {
        res.sendStatus(403);
        return;
      }
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  registerStorageProxy(app);
  registerUsernamePasswordAuth(app);
  registerOAuthRoutes(app);
  registerCommonAuthRoutes(app);

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, timestamp: Date.now() });
  });

  app.get("/api/ready", async (_req, res) => {
    try {
      const { getDb } = await import("../db");
      const db = await getDb();
      if (!db) {
        res.status(503).json({ ready: false, error: "Database not configured" });
        return;
      }
      await db.execute("SELECT 1");
      res.json({ ready: true, timestamp: Date.now() });
    } catch (error) {
      res.status(503).json({ ready: false, error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );

  const port = ENV.port;

  server.listen(port, () => {
    console.log(`[api] server listening on port ${port}`);
  });
}

startServer().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
