import { COOKIE_NAME, ONE_YEAR_MS } from "../../shared/const.js";
import type { Express, Request, Response } from "express";
import { randomBytes } from "node:crypto";
import { getUserByOpenId, upsertUser } from "../db";
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

export function registerOAuthRoutes(app: Express) {
  // Native Android Google Sign-In: the app obtains the ID token with the
  // native Google SDK and sends it directly to OmniShop. Do not use the
  // browser OAuth callback for this flow.
  app.post("/api/auth/google/native", async (req: Request, res: Response) => {
    // Accept the deployed Web Client ID and the app's known public client ID.
    // The token is still signature-verified by Google before it is accepted.
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
          // Try the next explicitly configured public client ID.
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
      res.json({
        app_session_id: sessionToken,
        user: buildUserResponse(user),
      });
    } catch (error) {
      console.error("[Google Native] Sign-in failed", error instanceof Error ? error.message : "unknown error");
      res.status(401).json({ error: "Google authentication failed" });
    }
  });

  // Direct Google OAuth start. The requested client redirect is only accepted when
  // explicitly allowlisted in GOOGLE_CLIENT_REDIRECT_URIS.
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
    // Keep the app/web destination in server memory; Google only returns to the
    // server callback URI registered in Google Cloud Console.
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

  // Existing Manus OAuth callback remains unchanged.
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
      const sessionToken = await sdk.createSessionToken(userInfo.openId!, { name: userInfo.name || "", expiresInMs: ONE_YEAR_MS });
      res.cookie(COOKIE_NAME, sessionToken, { ...getSessionCookieOptions(req), maxAge: ONE_YEAR_MS });
      res.redirect(302, process.env.EXPO_WEB_PREVIEW_URL || process.env.EXPO_PACKAGER_PROXY_URL || "http://localhost:8081");
    } catch (error) {
      console.error("[OAuth] Callback failed", error instanceof Error ? error.message : "unknown error");
      res.status(500).json({ error: "OAuth callback failed" });
    }
  });

  // Existing Manus mobile exchange remains available.
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
      const sessionToken = await sdk.createSessionToken(userInfo.openId!, { name: user.name || "", expiresInMs: ONE_YEAR_MS });
      res.cookie(COOKIE_NAME, sessionToken, { ...getSessionCookieOptions(req), maxAge: ONE_YEAR_MS });
      res.json({ app_session_id: sessionToken, user: buildUserResponse(user) });
    } catch (error) {
      console.error("[OAuth] Mobile exchange failed", error instanceof Error ? error.message : "unknown error");
      res.status(500).json({ error: "OAuth mobile exchange failed" });
    }
  });

  app.post("/api/auth/logout", (req: Request, res: Response) => {
    res.clearCookie(COOKIE_NAME, { ...getSessionCookieOptions(req), maxAge: -1 });
    res.json({ success: true });
  });

  app.get("/api/auth/me", async (req: Request, res: Response) => {
    try {
      const user = await sdk.authenticateRequest(req);
      res.json({ user: buildUserResponse(user) });
    } catch {
      res.status(401).json({ error: "Not authenticated", user: null });
    }
  });

  app.post("/api/auth/session", async (req: Request, res: Response) => {
    try {
      const user = await sdk.authenticateRequest(req);
      const authHeader = req.headers.authorization || req.headers.Authorization;
      if (typeof authHeader !== "string" || !authHeader.startsWith("Bearer ")) {
        res.status(400).json({ error: "Bearer token required" });
        return;
      }
      const token = authHeader.slice("Bearer ".length).trim();
      res.cookie(COOKIE_NAME, token, { ...getSessionCookieOptions(req), maxAge: ONE_YEAR_MS });
      res.json({ success: true, user: buildUserResponse(user) });
    } catch {
      res.status(401).json({ error: "Invalid token" });
    }
  });
}
