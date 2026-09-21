import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createRemoteJWKSet, customFetch, jwtVerify, type JWTPayload } from "jose";

export const GOOGLE_ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);
// Public OAuth client ID used by the Android app. It may still be overridden
// by the deployment environment, but the fallback prevents a blank or stale
// Render variable from making native sign-in reject every valid Google token.
export const DEFAULT_GOOGLE_WEB_CLIENT_ID = "994658294818-hcaup95copgvc327i4or6q4pq50b59qc.apps.googleusercontent.com";

export type GoogleOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  userInfoEndpoint?: string;
};

export type GoogleClaims = JWTPayload & {
  sub: string;
  email: string;
  email_verified?: boolean | "true";
  name?: string;
  picture?: string;
};

export type GoogleTokenResponse = {
  access_token: string;
  id_token?: string;
  token_type?: string;
  expires_in?: number;
};

const DEFAULT_AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const DEFAULT_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const DEFAULT_USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo";
const STATE_TTL_MS = 10 * 60 * 1000;

export function createOAuthState(): string {
  return randomBytes(32).toString("base64url");
}

export function hashOAuthState(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}

export function statesEqual(expected: string, actual: string): boolean {
  const left = Buffer.from(hashOAuthState(expected), "hex");
  const right = Buffer.from(hashOAuthState(actual), "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

export class OAuthStateStore {
  private readonly values = new Map<string, { expiresAt: number }>();

  constructor(private readonly ttlMs = STATE_TTL_MS) {}

  issue(state = createOAuthState()): string {
    this.values.set(hashOAuthState(state), { expiresAt: Date.now() + this.ttlMs });
    return state;
  }

  consume(state: string): boolean {
    const key = hashOAuthState(state);
    const record = this.values.get(key);
    this.values.delete(key);
    return Boolean(record && record.expiresAt > Date.now());
  }

  clear(): void {
    this.values.clear();
  }
}

export function assertAllowedRedirectUri(actual: string, expected: string): void {
  if (!actual || !expected || actual !== expected) {
    throw new Error("Google OAuth redirect URI mismatch");
  }
}

export function buildGoogleAuthorizationUrl(config: GoogleOAuthConfig, state: string): string {
  if (!config.clientId || !config.redirectUri) throw new Error("Google OAuth is not configured");
  const url = new URL(config.authorizationEndpoint ?? DEFAULT_AUTHORIZATION_ENDPOINT);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

export async function exchangeGoogleCode(
  config: GoogleOAuthConfig,
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GoogleTokenResponse> {
  if (!code) throw new Error("Google authorization code is required");
  const response = await fetchImpl(config.tokenEndpoint ?? DEFAULT_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!response.ok) throw new Error("Google authorization code exchange failed");
  const payload = (await response.json()) as Partial<GoogleTokenResponse>;
  if (typeof payload.access_token !== "string" || !payload.access_token) {
    throw new Error("Google token response did not contain an access token");
  }
  return payload as GoogleTokenResponse;
}

export function validateGoogleClaims(
  claims: GoogleClaims,
  clientId: string,
): GoogleClaims {
  if (!claims.sub || !claims.email) throw new Error("Google identity is incomplete");
  if (!GOOGLE_ISSUERS.has(String(claims.iss ?? ""))) throw new Error("Invalid Google token issuer");
  if (claims.aud !== clientId && !(Array.isArray(claims.aud) && claims.aud.includes(clientId))) {
    throw new Error("Invalid Google token audience");
  }
  if (claims.exp !== undefined && claims.exp <= Math.floor(Date.now() / 1000)) {
    throw new Error("Google token is expired");
  }
  if (claims.email_verified !== true && claims.email_verified !== "true") {
    throw new Error("Google email is not verified");
  }
  return claims;
}

export async function verifyGoogleIdToken(
  idToken: string,
  clientId: string,
  fetchImpl?: typeof fetch,
): Promise<GoogleClaims> {
  if (!idToken) throw new Error("Google ID token is required");
  const jwks = createRemoteJWKSet(
    new URL("https://www.googleapis.com/oauth2/v3/certs"),
    fetchImpl ? { [customFetch]: fetchImpl } : undefined,
  );
  const { payload } = await jwtVerify(idToken, jwks, {
    audience: clientId,
    issuer: [...GOOGLE_ISSUERS],
  });
  return validateGoogleClaims(payload as GoogleClaims, clientId);
}

export async function fetchGoogleUserInfo(
  accessToken: string,
  endpoint = DEFAULT_USERINFO_ENDPOINT,
  fetchImpl: typeof fetch = fetch,
): Promise<GoogleClaims> {
  if (!accessToken) throw new Error("Google access token is required");
  const response = await fetchImpl(endpoint, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error("Google user info request failed");
  return (await response.json()) as GoogleClaims;
}

export function getGoogleOAuthConfig(env: NodeJS.ProcessEnv = process.env): GoogleOAuthConfig {
  return {
    clientId: env.GOOGLE_CLIENT_ID_WEB?.trim() || DEFAULT_GOOGLE_WEB_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET_WEB ?? "",
    redirectUri: env.GOOGLE_REDIRECT_URI ?? "",
    authorizationEndpoint: env.GOOGLE_AUTHORIZATION_ENDPOINT,
    tokenEndpoint: env.GOOGLE_TOKEN_ENDPOINT,
    userInfoEndpoint: env.GOOGLE_USERINFO_ENDPOINT,
  };
}

export function isGoogleOAuthConfigured(config = getGoogleOAuthConfig()): boolean {
  return Boolean(config.clientId && config.clientSecret && config.redirectUri);
}

export function normalizeGoogleUser(claims: GoogleClaims) {
  return {
    openId: `google:${claims.sub}`,
    email: claims.email,
    name: claims.name ?? null,
    loginMethod: "google",
  } as const;
}
