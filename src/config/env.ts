import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default("24h"),
  FRONTEND_ORIGIN: z.string().url().default("http://localhost:3000"),
  AUTH_COOKIE_NAME: z.string().default("apollonft_admin_token"),
  AUTH_COOKIE_SAME_SITE: z.enum(["lax", "strict", "none"]).default("none"),
  AUTH_COOKIE_SECURE: z.coerce.boolean().default(true),
  AUTH_COOKIE_PARTITIONED: z.coerce.boolean().default(true),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
