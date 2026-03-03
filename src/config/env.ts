import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default("24h"),
  FRONTEND_ORIGINS: z.string().default("http://localhost:3000").transform((val) =>
    val.split(",").map((origin) => {
      const parsed = z.string().url().parse(origin.trim());
      return parsed;
    })
  ),
  AUTH_COOKIE_NAME: z.string().default("apollonft_admin_token"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
