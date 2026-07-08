import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "../config/env";
import { PrismaClient } from "../generated/prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __prismaClient: PrismaClient | undefined;
}

const databaseRequiresSsl =
  env.DATABASE_URL.includes("sslmode=require") ||
  env.DATABASE_URL.includes("sslmode=verify") ||
  env.DATABASE_URL.includes("sslmode=prefer");

const buildPgConnectionString = (databaseUrl: string): string => {
  const url = new URL(databaseUrl.replace(/^postgresql:/, "postgres:"));
  url.searchParams.delete("sslmode");
  return url.toString().replace(/^postgres:/, "postgresql:");
};

const adapter = new PrismaPg({
  connectionString: buildPgConnectionString(env.DATABASE_URL),
  ...(databaseRequiresSsl ? { ssl: { rejectUnauthorized: false } } : {}),
});

export const prisma = global.__prismaClient ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  global.__prismaClient = prisma;
}
