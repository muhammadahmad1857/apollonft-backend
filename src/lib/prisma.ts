import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { env } from "../config/env";
import { PrismaClient } from "../generated/prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __prismaClient: PrismaClient | undefined;
}

const LOCAL_DB_HOST_PATTERN = /@(localhost|127\.0\.0\.1|\[::1\])([:/]|$)/;

const stripSslMode = (databaseUrl: string): string => {
  const queryIndex = databaseUrl.indexOf("?");
  if (queryIndex === -1) {
    return databaseUrl;
  }

  const base = databaseUrl.slice(0, queryIndex);
  const params = databaseUrl
    .slice(queryIndex + 1)
    .split("&")
    .filter((param) => !param.startsWith("sslmode="));

  return params.length > 0 ? `${base}?${params.join("&")}` : base;
};

const buildPgPool = (databaseUrl: string): Pool => {
  const connectionString = stripSslMode(databaseUrl);
  const isLocalDatabase = LOCAL_DB_HOST_PATTERN.test(databaseUrl);

  if (isLocalDatabase) {
    return new Pool({ connectionString });
  }

  return new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });
};

const pool = buildPgPool(env.DATABASE_URL);
const adapter = new PrismaPg(pool);

export const prisma = global.__prismaClient ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  global.__prismaClient = prisma;
}
