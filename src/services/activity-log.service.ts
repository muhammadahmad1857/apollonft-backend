import type { Prisma } from "../generated/prisma/client";
import { prisma } from "../lib/prisma";

type LogActivityInput = {
  userId: number;
  action: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
};

export const logActivity = async ({ userId, action, metadata, ipAddress }: LogActivityInput): Promise<void> => {
  await prisma.activityLog.create({
    data: {
      userId,
      action,
      metadata: metadata as Prisma.InputJsonValue | undefined,
      ipAddress: ipAddress ?? null,
    },
  });
};
