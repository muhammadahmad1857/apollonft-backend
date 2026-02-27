import crypto from "node:crypto";
import { verifyMessage } from "ethers";
import { UserRole } from "../generated/prisma/enums";
import { HttpError } from "../lib/http-error";
import { signAuthToken } from "../lib/jwt";
import { prisma } from "../lib/prisma";

const adminRoles = new Set<UserRole>([UserRole.ADMIN, UserRole.SUPER_ADMIN]);

export const buildNonceMessage = (nonce: string): string => {
  return `Login to Apollonft Admin Panel.\nNonce: ${nonce}`;
};

export const createNonce = async (walletAddress: string): Promise<{ nonce: string; message: string }> => {
  const normalizedAddress = walletAddress.toLowerCase();

  const user = await prisma.user.findUnique({
    where: { walletAddress: normalizedAddress },
    select: { id: true, role: true },
  });

  if (!user) {
    throw new HttpError(404, "Admin user not found", "ADMIN_NOT_FOUND");
  }

  if (!adminRoles.has(user.role as UserRole)) {
    throw new HttpError(403, "Admin access required", "ADMIN_ONLY");
  }

  const nonce = crypto.randomBytes(16).toString("hex");

  await prisma.user.update({
    where: { id: user.id },
    data: { nonce },
  });

  return {
    nonce,
    message: buildNonceMessage(nonce),
  };
};

export const verifyWalletSignature = async (walletAddress: string, signature: string) => {
  const normalizedAddress = walletAddress.toLowerCase();

  const user = await prisma.user.findUnique({
    where: { walletAddress: normalizedAddress },
    select: {
      id: true,
      walletAddress: true,
      role: true,
      isBlocked: true,
      nonce: true,
      name: true,
      avatarUrl: true,
    },
  });

  if (!user) {
    throw new HttpError(404, "Admin user not found", "ADMIN_NOT_FOUND");
  }

  if (!user.nonce) {
    throw new HttpError(400, "Nonce missing or expired", "NONCE_MISSING");
  }

  const message = buildNonceMessage(user.nonce);
  const recoveredAddress = verifyMessage(message, signature).toLowerCase();

  if (recoveredAddress !== normalizedAddress) {
    throw new HttpError(401, "Invalid signature", "INVALID_SIGNATURE");
  }

  if (user.isBlocked) {
    throw new HttpError(403, "User is blocked", "USER_BLOCKED");
  }

  if (!adminRoles.has(user.role as UserRole)) {
    throw new HttpError(403, "Admin access required", "ADMIN_ONLY");
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      nonce: null,
      lastLoginAt: new Date(),
    },
  });

  const token = signAuthToken({
    userId: user.id,
    walletAddress: user.walletAddress,
    role: user.role,
  });

  return {
    token,
    user: {
      id: user.id,
      walletAddress: user.walletAddress,
      role: user.role,
      name: user.name,
      avatarUrl: user.avatarUrl,
    },
  };
};
