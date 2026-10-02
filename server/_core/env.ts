/**
 * Environment configuration with strict validation.
 * All required variables must be present; no defaults in production.
 */

function getEnv(key: string, defaultValue?: string): string {
  const value = process.env[key] ?? defaultValue;
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value.trim();
}

function getEnvOptional(key: string, defaultValue?: string): string {
  return (process.env[key] ?? defaultValue ?? "").trim();
}

function validateJwtSecret(secret: string): void {
  if (!secret || secret.length < 32) {
    throw new Error("JWT_SECRET must be at least 32 characters");
  }
}

function validateDatabaseUrl(url: string): void {
  if (!url || !url.startsWith("mysql://")) {
    throw new Error("DATABASE_URL must be a valid MySQL connection string");
  }
}

function validateEmail(email: string): void {
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error(`Invalid email format: ${email}`);
  }
}

function validateOrigins(origins: string): string[] {
  if (!origins) {
    throw new Error("ALLOWED_ORIGINS must be specified (comma-separated)");
  }
  return origins
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

// Validate and build ENV object
const jwtSecret = getEnv("JWT_SECRET");
validateJwtSecret(jwtSecret);

const databaseUrl = getEnv("DATABASE_URL");
validateDatabaseUrl(databaseUrl);

const ownerEmail = getEnv("OWNER_EMAIL");
validateEmail(ownerEmail);

const allowedOriginsStr = getEnv("ALLOWED_ORIGINS");
const allowedOrigins = validateOrigins(allowedOriginsStr);

export const ENV = {
  appId: getEnvOptional("VITE_APP_ID", "omnishop-app"),
  cookieSecret: jwtSecret,
  databaseUrl,
  oAuthServerUrl: getEnvOptional("OAUTH_SERVER_URL"),
  ownerEmail: ownerEmail.toLowerCase(),
  enableOAuth: process.env.OAUTH_ENABLED === "true",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: getEnvOptional("BUILT_IN_FORGE_API_URL"),
  forgeApiKey: getEnvOptional("BUILT_IN_FORGE_API_KEY"),
  port: parseInt(process.env.PORT || "3000", 10),
  allowedOrigins,
};

// Validate in production
if (ENV.isProduction) {
  if (!ENV.databaseUrl) {
    throw new Error("Production deployment requires DATABASE_URL");
  }
  if (!ENV.cookieSecret || ENV.cookieSecret.length < 32) {
    throw new Error("Production deployment requires JWT_SECRET (≥32 chars)");
  }
  if (!ENV.ownerEmail) {
    throw new Error("Production deployment requires OWNER_EMAIL");
  }
  if (ENV.allowedOrigins.length === 0) {
    throw new Error("Production deployment requires ALLOWED_ORIGINS");
  }
}
