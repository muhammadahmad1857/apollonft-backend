import { z } from "zod";

const walletAddressSchema = z
  .string()
  .trim()
  .min(1)
  .transform((value) => value.toLowerCase());

export const listNotificationsSchema = z.object({
  query: z.object({
    wallet: walletAddressSchema,
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  }),
  params: z.unknown().optional(),
  body: z.unknown().optional(),
});

export const unreadCountSchema = z.object({
  query: z.object({
    wallet: walletAddressSchema,
  }),
  params: z.unknown().optional(),
  body: z.unknown().optional(),
});

export const markNotificationReadSchema = z.object({
  params: z.object({
    id: z.coerce.number().int().positive(),
  }),
  query: z.object({
    wallet: walletAddressSchema,
  }),
  body: z.unknown().optional(),
});

export const markAllNotificationsReadSchema = z.object({
  query: z.object({
    wallet: walletAddressSchema,
  }),
  params: z.unknown().optional(),
  body: z.unknown().optional(),
});

export const streamNotificationsSchema = z.object({
  query: z.object({
    wallet: walletAddressSchema,
  }),
  params: z.unknown().optional(),
  body: z.unknown().optional(),
});
