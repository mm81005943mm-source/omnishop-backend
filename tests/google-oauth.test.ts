import { describe, expect, it } from "vitest";
import {
  OAuthStateStore,
  assertAllowedRedirectUri,
  buildGoogleAuthorizationUrl,
  exchangeGoogleCode,
  normalizeGoogleUser,
  validateGoogleClaims,
} from "../server/_core/google-oauth";

const claims = {
  iss: "https://accounts.google.com",
  aud: "web-client-id",
  sub: "123456789",
  email: "user@example.com",
  email_verified: true,
  name: "Test User",
};

const config = {
  clientId: "web-client-id",
  clientSecret: "secret-only-on-server",
  redirectUri: "https://shop.example.com/api/auth/google/callback",
};

describe("Google OAuth server validation", () => {
  it("accepts a fresh state once and rejects replay", () => {
    const store = new OAuthStateStore();
    const state = store.issue("state-value");
    expect(store.consume(state)).toBe(true);
    expect(store.consume(state)).toBe(false);
  });

  it("rejects an unknown or missing state", () => {
    const store = new OAuthStateStore();
    store.issue("expected-state");
    expect(store.consume("wrong-state")).toBe(false);
    expect(store.consume("")).toBe(false);
  });

  it("rejects an expired state", () => {
    const store = new OAuthStateStore(0);
    const state = store.issue("expired-state");
    expect(store.consume(state)).toBe(false);
  });

  it("builds an authorization URL with required parameters", () => {
    const url = new URL(buildGoogleAuthorizationUrl(config, "state-value"));
    expect(url.searchParams.get("client_id")).toBe("web-client-id");
    expect(url.searchParams.get("state")).toBe("state-value");
    expect(url.searchParams.get("redirect_uri")).toBe(config.redirectUri);
    expect(url.searchParams.get("response_type")).toBe("code");
  });

  it("rejects redirect URI mismatches", () => {
    expect(() => assertAllowedRedirectUri("https://evil.example/callback", config.redirectUri)).toThrow(
      /redirect URI mismatch/i,
    );
  });

  it("rejects a missing authorization code", async () => {
    await expect(exchangeGoogleCode(config, "", async () => new Response())).rejects.toThrow(/code/i);
  });

  it("accepts a valid mocked authorization-code exchange", async () => {
    const response = await exchangeGoogleCode(config, "auth-code", async (input, init) => {
      expect(input).toBe("https://oauth2.googleapis.com/token");
      expect(init?.method).toBe("POST");
      return new Response(JSON.stringify({ access_token: "access", id_token: "id" }), { status: 200 });
    });
    expect(response.access_token).toBe("access");
    expect(response.id_token).toBe("id");
  });

  it("accepts a valid issuer, audience, and verified email", () => {
    expect(validateGoogleClaims(claims, "web-client-id")).toEqual(claims);
  });

  it("rejects invalid issuer, audience, or unverified email", () => {
    expect(() => validateGoogleClaims({ ...claims, iss: "https://evil.example" }, "web-client-id")).toThrow(/issuer/i);
    expect(() => validateGoogleClaims({ ...claims, aud: "other-client" }, "web-client-id")).toThrow(/audience/i);
    expect(() => validateGoogleClaims({ ...claims, email_verified: false }, "web-client-id")).toThrow(/verified/i);
  });

  it("rejects an expired or invalid token claim set", () => {
    expect(() => validateGoogleClaims({ ...claims, exp: 1 }, "web-client-id")).toThrow(/expired/i);
    expect(() => validateGoogleClaims({ ...claims, email: "" }, "web-client-id")).toThrow(/incomplete/i);
  });

  it("normalizes a Google user without a name", () => {
    expect(normalizeGoogleUser({ ...claims, name: undefined })).toEqual({
      openId: "google:123456789",
      email: "user@example.com",
      name: null,
      loginMethod: "google",
    });
  });
});
