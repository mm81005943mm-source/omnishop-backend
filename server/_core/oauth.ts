import { COOKIE_NAME, ONE_YEAR_MS } from "../../shared/const.js";
import type { Express, Request, Response } from "express";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { getDb, getUserByOpenId, upsertUser } from "../db";
import { sql } from "drizzle-orm";
import { getSessionCookieOptions } from "./cookies";
import {
  buildGoogleAuthorizationUrl,
  exchangeGoogleCode,
  getGoogleOAuthConfig,
  isGoogleOAuthConfigured,
  OAuthStateStore,
  DEFAULT_GOOGLE_WEB_CLIENT_ID,
  validateGoogleClaims,
  verifyGoogleIdToken,
} from "./google-oauth";
import { sdk } from "./sdk";
import { ENV } from "./env";

function getQueryParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

async function syncUser(userInfo: {
  openId?: string | null;
  name?: string | null;
  email?: string | null;
  loginMethod?: string | null;
  platform?: string | null;
}) {
  if (!userInfo.openId) throw new Error("openId missing from user info");
  const lastSignedIn = new Date();
  await upsertUser({
    openId: userInfo.openId,
    name: userInfo.name || null,
    email: userInfo.email ?? null,
    loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
    lastSignedIn,
  });
  const saved = await getUserByOpenId(userInfo.openId);
  return saved ?? {
    openId: userInfo.openId,
    name: userInfo.name,
    email: userInfo.email,
    loginMethod: userInfo.loginMethod ?? null,
    lastSignedIn,
  };
}

function buildUserResponse(user: any) {
  return {
    id: user?.id ?? null,
    openId: user?.openId ?? null,
    name: user?.name ?? null,
    email: user?.email ?? null,
    loginMethod: user?.loginMethod ?? null,
    lastSignedIn: (user?.lastSignedIn ?? new Date()).toISOString(),
  };
}

const googleStates = new OAuthStateStore();
const handoffs = new Map<string, { sessionToken: string; user: unknown; expiresAt: number }>();

function allowedClientRedirect(uri: string): boolean {
  const allowed = (process.env.GOOGLE_CLIENT_REDIRECT_URIS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return Boolean(uri && allowed.includes(uri));
}

function issueHandoff(sessionToken: string, user: unknown): string {
  const code = randomBytes(32).toString("base64url");
  handoffs.set(code, { sessionToken, user, expiresAt: Date.now() + 60_000 });
  return code;
}

function consumeHandoff(code: string) {
  const handoff = handoffs.get(code);
  handoffs.delete(code);
  return handoff && handoff.expiresAt > Date.now() ? handoff : null;
}

export function registerUsernamePasswordAuth(app: Express) {
  let usernameAuthReady: Promise<void> | null = null;
  const ensureUsernameAuthTable = async () => {
    if (!usernameAuthReady) {
      usernameAuthReady = (async () => {
        const db = await getDb();
        if (!db) throw new Error("Database is not configured");
        await db.execute(sql`CREATE TABLE IF NOT EXISTS username_credentials (
          user_id INT NOT NULL PRIMARY KEY,
          username VARCHAR(255) NOT NULL UNIQUE,
          password_hash VARCHAR(255) NOT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT username_credentials_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )`);
      })();
    }
    return usernameAuthReady;
  };

  const normalizeUsername = (value: unknown) =>
    typeof value === "string" ? value.trim().toLowerCase().slice(0, 255) : "";

  const hashPassword = (password: string) => {
    const salt = randomBytes(16).toString("hex");
    const derived = scryptSync(password, salt, 64).toString("hex");
    return `${salt}:${derived}`;
  };

  const verifyPassword = (password: string, encoded: string) => {
    const [salt, expected] = encoded.split(":");
    if (!salt || !expected) return false;
    const actual = scryptSync(password, salt, 64);
    const target = Buffer.from(expected, "hex");
    return target.length === actual.length && timingSafeEqual(actual, target);
  };

  const usernameUserResponse = (user: any) => ({
    id: user?.id ?? null,
    openId: user?.openId ?? null,
    name: user?.name ?? null,
    email: user?.email ?? null,
    loginMethod: "username",
    lastSignedIn: new Date().toISOString(),
  });

  const usernameAuth = async (req: Request, res: Response) => {
    try {
      await ensureUsernameAuthTable();
      const username = normalizeUsername(req.body?.username);
      const password = typeof req.body?.password === "string" ? req.body.password : "";
      const name = typeof req.body?.name === "string" ? req.body.name.trim().slice(0, 120) : "";
      const register = req.path.includes("/register");

      if (!username || username.length < 3 || password.length < 8 || password.length > 128) {
        res.status(400).json({
          error: register
            ? "Username (3+ chars), name, and password (8-128 chars) required"
            : "Invalid username or password",
        });
        return;
      }

      if (register && !name) {
        res.status(400).json({ error: "Name is required for registration" });
        return;
      }

      const db = await getDb();
      if (!db) throw new Error("Database is not configured");
      const rows: any = await db.execute(
        sql`SELECT user_id, password_hash FROM username_credentials WHERE username = ${username} LIMIT 1`
      );
      const credential = (rows as any)?.[0]?.[0] ?? (rows as any)?.[0] ?? null;

      if (register) {
        if (credential) {
          res.status(409).json({ error: "Username already registered" });
          return;
        }
        await upsertUser({
          openId: `username:${username}`,
          email: null,
          name,
          loginMethod: "username",
          lastSignedIn: new Date(),
        });
        const user = await getUserByOpenId(`username:${username}`);
        if (!user?.id) throw new Error("Could not create user");
        await db.execute(
          sql`INSERT INTO username_credentials (user_id, username, password_hash) VALUES (${user.id}, ${username}, ${hashPassword(password)})`
        );
        const token = await sdk.createSessionToken(`username:${username}`, {
          name,
          expiresInMs: ONE_YEAR_MS,
        });
        res.status(201).json({
          app_session_id: token,
          user: usernameUserResponse({ ...user, name }),
        });
        return;
      }

      if (!credential || !verifyPassword(password, credential.password_hash)) {
        res.status(401).json({ error: "Invalid username or password" });
        return;
      }

      const user = await getUserByOpenId(`username:${username}`);
      if (!user) {
        res.status(401).json({ error: "Invalid username or password" });
        return;
      }

      await upsertUser({ openId: `username:${username}`, lastSignedIn: new Date() });
      const token = await sdk.createSessionToken(`username:${username}`, {
        name: user.name ?? "",
        expiresInMs: ONE_YEAR_MS,
      });
      res.json({ app_session_id: token, user: usernameUserResponse(user) });
    } catch (error) {
      console.error("[Username Auth] failed", error instanceof Error ? error.message : "unknown error");
      res.status(500).json({ error: "Authentication failed" });
    }
  };

  app.post("/api/auth/username/register", usernameAuth);
  app.post("/api/auth/username/login", usernameAuth);
}

export function registerOAuthRoutes(app: Express) {
  if (!ENV.enableOAuth) return;

  app.post("/api/auth/google/native", async (req: Request, res: Response) => {
    const googleClientIds = [process.env.GOOGLE_CLIENT_ID_WEB?.trim(), DEFAULT_GOOGLE_WEB_CLIENT_ID]
      .filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index);

    if (!googleClientIds.length) {
      res.status(503).json({ error: "Google OAuth is not configured" });
      return;
    }

    const idToken = typeof req.body?.idToken === "string" ? req.body.idToken.trim() : "";
    if (!idToken || idToken.length > 16_384) {
      res.status(401).json({ error: "Google authentication failed" });
      return;
    }

    try {
      let verified: Awaited<ReturnType<typeof verifyGoogleIdToken>> | null = null;
      for (const clientId of googleClientIds) {
        try {
          const claims = await verifyGoogleIdToken(idToken, clientId);
          verified = validateGoogleClaims(claims, clientId);
          break;
        } catch {
          // Try next client ID
        }
      }
      if (!verified) throw new Error("Google token did not match a configured client ID");

      const user = await syncUser({
        openId: `google:${verified.sub}`,
        name: verified.name ?? null,
        email: verified.email,
        loginMethod: "google",
        platform: "native",
      });

      const sessionToken = await sdk.createSessionToken(`google:${verified.sub}`, {
        name: verified.name ?? "",
        expiresInMs: ONE_YEAR_MS,
      });

      res.json({ app_session_id: sessionToken, user: buildUserResponse(user) });
    } catch (error) {
      console.error("[Google Native] Sign-in failed", error instanceof Error ? error.message : "unknown error");
      res.status(401).json({ error: "Google authentication failed" });
    }
  });

  app.get("/api/auth/google", (req: Request, res: Response) => {
    const config = getGoogleOAuthConfig();
    const redirectUri = getQueryParam(req, "redirectUri");
    if (!isGoogleOAuthConfigured(config)) {
      res.status(503).json({ error: "Google OAuth is not configured" });
      return;
    }
    if (!redirectUri || !allowedClientRedirect(redirectUri)) {
      res.status(400).json({ error: "Unsupported OAuth client redirect URI" });
      return;
    }
    const state = googleStates.issue(getQueryParam(req, "state"));
    (req.app as any).locals.googleRedirects ??= new Map<string, string>();
    (req.app as any).locals.googleRedirects.set(state, redirectUri);
    res.redirect(302, buildGoogleAuthorizationUrl(config, state));
  });

  app.get("/api/auth/google/callback", async (req: Request, res: Response) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");
    const oauthError = getQueryParam(req, "error");
    const redirectMap = (req.app as any).locals.googleRedirects as Map<string, string> | undefined;
    const clientRedirect = state ? redirectMap?.get(state) : undefined;
    if (state) redirectMap?.delete(state);
    if (oauthError) {
      res.status(400).json({ error: "Google OAuth was cancelled or failed" });
      return;
    }
    if (!code || !state || !googleStates.consume(state)) {
      res.status(400).json({ error: "Invalid or expired Google OAuth state" });
      return;
    }
    if (!clientRedirect || !allowedClientRedirect(clientRedirect)) {
      res.status(400).json({ error: "Unsupported OAuth client redirect URI" });
      return;
    }

    try {
      const config = getGoogleOAuthConfig();
      const tokens = await exchangeGoogleCode(config, code);
      if (!tokens.id_token) throw new Error("Google response did not contain an ID token");
      const claims = await verifyGoogleIdToken(tokens.id_token, config.clientId);
      const verified = validateGoogleClaims(claims, config.clientId);
      const user = await syncUser({
        openId: `google:${verified.sub}`,
        name: verified.name ?? null,
        email: verified.email,
        loginMethod: "google",
      });
      const sessionToken = await sdk.createSessionToken(`google:${verified.sub}`, {
        name: verified.name ?? "",
        expiresInMs: ONE_YEAR_MS,
      });
      const handoffCode = issueHandoff(sessionToken, buildUserResponse(user));
      const target = new URL(clientRedirect);
      target.searchParams.set("code", handoffCode);
      target.searchParams.set("state", state);
      res.redirect(302, target.toString());
    } catch (error) {
      console.error("[Google OAuth] Callback failed", error instanceof Error ? error.message : "unknown error");
      res.status(502).json({ error: "Google authentication failed" });
    }
  });

  const exchangeGoogleHandoff = (req: Request, res: Response) => {
    const code = getQueryParam(req, "code");
    const handoff = code ? consumeHandoff(code) : null;
    if (!handoff) {
      res.status(401).json({ error: "Invalid or expired OAuth exchange code" });
      return;
    }
    const cookieOptions = getSessionCookieOptions(req);
    res.cookie(COOKIE_NAME, handoff.sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
    res.json({ app_session_id: handoff.sessionToken, user: handoff.user });
  };

  app.get("/api/auth/google/exchange", exchangeGoogleHandoff);
  app.post("/api/auth/google/exchange", exchangeGoogleHandoff);
  app.get("/api/auth/google/mobile", exchangeGoogleHandoff);
  app.post("/api/auth/google/mobile", exchangeGoogleHandoff);

  app.get("/api/oauth/callback", async (req: Request, res: Response) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");
    const redirectUri = getQueryParam(req, "redirectUri");
    if (!code || !state || !redirectUri) {
      res.status(400).json({ error: "code, state and redirectUri are required" });
      return;
    }
    try {
      const tokenResponse = await sdk.exchangeCodeForToken(code, redirectUri);
      const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
      await syncUser(userInfo);
      const sessionToken = await sdk.createSessionToken(userInfo.openId!, {
        name: userInfo.name || "",
        expiresInMs: ONE_YEAR_MS,
      });
      res.cookie(COOKIE_NAME, sessionToken, { ...getSessionCookieOptions(req), maxAge: ONE_YEAR_MS });
      res.redirect(302, process.env.EXPO_WEB_PREVIEW_URL || process.env.EXPO_PACKAGER_PROXY_URL || "http://localhost:8081");
    } catch (error) {
      console.error("[OAuth] Callback failed", error instanceof Error ? error.message : "unknown error");
      res.status(500).json({ error: "OAuth callback failed" });
    }
  });

  app.get("/api/oauth/mobile", async (req: Request, res: Response) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");
    const redirectUri = getQueryParam(req, "redirectUri");
    if (!code || !state || !redirectUri) {
      res.status(400).json({ error: "code, state and redirectUri are required" });
      return;
    }
    try {
      const tokenResponse = await sdk.exchangeCodeForToken(code, redirectUri);
      const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
      const user = await syncUser(userInfo);
      const sessionToken = await sdk.createSessionToken(userInfo.openId!, {
        name: user.name || "",
        expiresInMs: ONE_YEAR_MS,
      });
      res.cookie(COOKIE_NAME, sessionToken, { ...getSessionCookieOptions(req), maxAge: ONE_YEAR_MS });
      res.json({ app_session_id: sessionToken, user: buildUserResponse(user) });
    } catch (error) {
      console.error("[OAuth] Mobile exchange failed", error instanceof Error ? error.message : "unknown error");
      res.status(500).json({ error: "OAuth mobile exchange failed" });
    }
  });
}

export function registerCommonAuthRoutes(app: Express) {
  app.post("/api/auth/logout", (req: Request, res: Response) => {
    res.clearCookie(COOKIE_NAME, { ...getSessionCookieOptions(req), maxAge: -1 });
    res.json({ success: true });
  });

  app.get("/api/auth/me", async (req: Request, res: Response) => {
    try {
      const user = await sdk.authenticateRequest(req);
      res.json({ user: user ? buildUserResponse(user) : null });
    } catch {
      res.json({ user: null });
    }
  });

  app.post("/api/auth/session", async (req: Request, res: Response) => {
    try {
      const authHeader = req.headers.authorization || req.headers.Authorization;
      if (typeof authHeader !== "string" || !authHeader.startsWith("Bearer ")) {
        res.status(400).json({ error: "Bearer token required" });
        return;
      }
      const token = authHeader.slice("Bearer ".length).trim();
      const user = await sdk.authenticateRequest(req);
      res.cookie(COOKIE_NAME, token, { ...getSessionCookieOptions(req), maxAge: ONE_YEAR_MS });
      res.json({ success: true, user: user ? buildUserResponse(user) : null });
    } catch {
      res.status(401).json({ error: "Invalid token" });
    }
  });
}
