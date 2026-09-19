import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyGoogleIdToken = vi.fn();
const validateGoogleClaims = vi.fn();
const createSessionToken = vi.fn();
const upsertUser = vi.fn();
const getUserByOpenId = vi.fn();

vi.mock("../server/_core/google-oauth", async () => {
  const actual = await vi.importActual<typeof import("../server/_core/google-oauth")>("../server/_core/google-oauth");
  return {
    ...actual,
    verifyGoogleIdToken,
    validateGoogleClaims,
  };
});

vi.mock("../server/_core/sdk", () => ({
  sdk: {
    createSessionToken,
  },
}));

vi.mock("../server/db", () => ({
  upsertUser,
  getUserByOpenId,
}));

async function appForTest() {
  const app = express();
  app.use(express.json());
  const { registerOAuthRoutes } = await import("../server/_core/oauth");
  registerOAuthRoutes(app);
  return app;
}

describe("POST /api/auth/google/native", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.GOOGLE_CLIENT_ID_WEB = "web-client-id";
    validateGoogleClaims.mockReturnValue({
      sub: "google-sub",
      email: "user@example.com",
      email_verified: true,
      name: "Test User",
      iss: "https://accounts.google.com",
      aud: "web-client-id",
    });
    verifyGoogleIdToken.mockResolvedValue({});
    upsertUser.mockResolvedValue(undefined);
    getUserByOpenId.mockResolvedValue({
      id: 7,
      openId: "google:google-sub",
      name: "Test User",
      email: "user@example.com",
      loginMethod: "google",
      lastSignedIn: new Date("2026-01-01T00:00:00.000Z"),
    });
    createSessionToken.mockResolvedValue("omnishop-session-jwt");
  });

  it("returns 503 when GOOGLE_CLIENT_ID_WEB is missing", async () => {
    delete process.env.GOOGLE_CLIENT_ID_WEB;
    const response = await request(await appForTest())
      .post("/api/auth/google/native")
      .send({ idToken: "token" });

    expect(response.status).toBe(503);
    expect(verifyGoogleIdToken).not.toHaveBeenCalled();
  });

  it("returns 401 when the ID token cannot be verified", async () => {
    verifyGoogleIdToken.mockRejectedValueOnce(new Error("bad signature"));
    const response = await request(await appForTest())
      .post("/api/auth/google/native")
      .send({ idToken: "invalid-token" });

    expect(response.status).toBe(401);
    expect(createSessionToken).not.toHaveBeenCalled();
  });

  it("validates against the web audience, syncs the Google subject, and creates a session", async () => {
    const response = await request(await appForTest())
      .post("/api/auth/google/native")
      .send({ idToken: "signed-google-id-token" });

    expect(response.status).toBe(200);
    expect(verifyGoogleIdToken).toHaveBeenCalledWith("signed-google-id-token", "web-client-id");
    expect(validateGoogleClaims).toHaveBeenCalledWith({}, "web-client-id");
    expect(upsertUser).toHaveBeenCalledWith(expect.objectContaining({
      openId: "google:google-sub",
      loginMethod: "google",
    }));
    expect(createSessionToken).toHaveBeenCalledWith("google:google-sub", expect.objectContaining({ name: "Test User" }));
    expect(response.body).toEqual({
      app_session_id: "omnishop-session-jwt",
      user: {
        id: 7,
        openId: "google:google-sub",
        name: "Test User",
        email: "user@example.com",
        loginMethod: "google",
        lastSignedIn: "2026-01-01T00:00:00.000Z",
      },
    });
  });
});
