import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "../config/env";
import { PrismaClient } from "../generated/prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __prismaClient: PrismaClient | undefined;
}

const LOCAL_DB_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

const buildPgPoolConfig = (databaseUrl: string) => {
  const url = new URL(databaseUrl.replace(/^postgresql:/, "postgres:"));
  const isLocalDatabase = LOCAL_DB_HOSTS.has(url.hostname);

  // pg treats sslmode from the URL as strict cert verification; strip it so we control SSL explicitly.
  url.searchParams.delete("sslmode");

  const connectionString = url.toString().replace(/^postgres:/, "postgresql:");

  if (isLocalDatabase) {
    return { connectionString };
  }

  // Managed providers (e.g. Akamai) use certs that Node may not trust by default.
  return {
    connectionString,
    ssl: { rejectUnauthorized: false },
  };
};

const adapter = new PrismaPg(buildPgPoolConfig(env.DATABASE_URL));

export const prisma = global.__prismaClient ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  global.__prismaClient = prisma;
}
