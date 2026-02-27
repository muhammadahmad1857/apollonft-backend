import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "../config/env";
import { PrismaClient } from "../generated/prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __prismaClient: PrismaClient | undefined;
}

const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });

export const prisma = global.__prismaClient ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  global.__prismaClient = prisma;
}
