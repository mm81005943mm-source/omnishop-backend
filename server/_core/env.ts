export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  // Use owner email only for admin/owner checks. Default to the single owner required for this project.
  ownerEmail: (process.env.OWNER_EMAIL ?? "mm81005943mm@gmail.com").trim().toLowerCase(),
  // Google OAuth is opt-in. Default should be false.
  enableOAuth: process.env.OAUTH_ENABLED === "true",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
};
