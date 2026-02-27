import { z } from "zod";

const ethAddressRegex = /^0x[a-fA-F0-9]{40}$/;

export const getNonceSchema = z.object({
  query: z.object({
    address: z.string().regex(ethAddressRegex, "Invalid wallet address"),
  }),
  body: z.unknown().optional(),
  params: z.unknown().optional(),
});

export const verifySignatureSchema = z.object({
  body: z.object({
    address: z.string().regex(ethAddressRegex, "Invalid wallet address"),
    signature: z.string().min(1),
  }),
  query: z.unknown().optional(),
  params: z.unknown().optional(),
});
