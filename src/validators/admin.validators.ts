import { z } from "zod";
import { UserRole } from "../generated/prisma/enums";

const roleValues = [UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.USER] as const;
const nftStatusValues = ["ACTIVE", "FLAGGED", "DELISTED", "HIDDEN"] as const;

export const listUsersSchema = z.object({
  query: z.object({
    q: z.string().trim().optional(),
    role: z.enum(roleValues).optional(),
    blocked: z.enum(["true", "false"]).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(10),
  }),
  body: z.unknown().optional(),
  params: z.unknown().optional(),
});

export const userIdParamSchema = z.object({
  params: z.object({
    id: z.coerce.number().int().positive(),
  }),
  body: z.unknown().optional(),
  query: z.unknown().optional(),
});

export const blockUserSchema = z.object({
  params: z.object({
    id: z.coerce.number().int().positive(),
  }),
  body: z.object({
    isBlocked: z.boolean(),
  }),
  query: z.unknown().optional(),
});

export const changeRoleSchema = z.object({
  params: z.object({
    id: z.coerce.number().int().positive(),
  }),
  body: z.object({
    role: z.enum(roleValues),
  }),
  query: z.unknown().optional(),
});

export const activityQuerySchema = z.object({
  params: z.object({
    id: z.coerce.number().int().positive(),
  }),
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  }),
  body: z.unknown().optional(),
});

export const dashboardStatsSchema = z.object({
  query: z.unknown().optional(),
  body: z.unknown().optional(),
  params: z.unknown().optional(),
});

export const listNftsSchema = z.object({
  query: z.object({
    q: z.string().trim().optional(),
    status: z.enum(nftStatusValues).optional(),
    listed: z.enum(["true", "false"]).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(10),
  }),
  body: z.unknown().optional(),
  params: z.unknown().optional(),
});

export const updateNftStatusSchema = z.object({
  params: z.object({
    id: z.coerce.number().int().positive(),
  }),
  body: z.object({
    status: z.enum(nftStatusValues),
    reason: z.string().trim().max(300).optional(),
  }),
  query: z.unknown().optional(),
});

export const delistNftSchema = z.object({
  params: z.object({
    id: z.coerce.number().int().positive(),
  }),
  body: z.object({
    reason: z.string().trim().max(300).optional(),
    txHash: z.string().trim().min(1).optional(),
  }),
  query: z.unknown().optional(),
});

export const listAuctionsSchema = z.object({
  query: z.object({
    q: z.string().trim().optional(),
    frozen: z.enum(["true", "false"]).optional(),
    settled: z.enum(["true", "false"]).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(10),
  }),
  body: z.unknown().optional(),
  params: z.unknown().optional(),
});

export const freezeAuctionSchema = z.object({
  params: z.object({
    id: z.coerce.number().int().positive(),
  }),
  body: z.object({
    frozen: z.boolean(),
    reason: z.string().trim().max(300).optional(),
  }),
  query: z.unknown().optional(),
});

export const listAdminActivitySchema = z.object({
  query: z.object({
    q: z.string().trim().optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  }),
  body: z.unknown().optional(),
  params: z.unknown().optional(),
});
