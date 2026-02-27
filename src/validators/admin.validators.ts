import { z } from "zod";
import { UserRole } from "../generated/prisma/enums";

const roleValues = [UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.USER] as const;

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
