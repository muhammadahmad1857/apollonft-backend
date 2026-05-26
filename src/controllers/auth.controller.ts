import type { Request, Response } from "express";
import { env } from "../config/env";
import { HttpError } from "../lib/http-error";
import { prisma } from "../lib/prisma";
import { logActivity } from "../services/activity-log.service";
import { createNonce, verifyWalletSignature } from "../services/auth.service";

const authCookieOptions = {
  httpOnly: true,
  domain: ".apollonft.io",
sameSite: "lax" as const,
secure: true,
  maxAge: 24 * 60 * 60 * 1000,
};

const maskToken = (token: string | null | undefined): string => {
  if (!token) return "none";
  if (token.length <= 12) return `${token.slice(0, 4)}...(${token.length})`;
  return `${token.slice(0, 8)}...${token.slice(-4)} (${token.length})`;
};

const getIpAddress = (req: Request): string | null => {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    return forwarded.split(",")[0]?.trim() ?? null;
  }
  return req.ip ?? null;
};

export const getNonceController = async (req: Request, res: Response): Promise<void> => {
  const address = String(req.query.address);
  console.log("[AUTH_DEBUG][BACKEND][nonce] request", { address, ip: getIpAddress(req) });
  const result = await createNonce(address);
  console.log("[AUTH_DEBUG][BACKEND][nonce] success", { address, hasMessage: Boolean(result.message) });
  res.status(200).json({
    success: true,
    message: "Nonce generated",
    data: {
      message: result.message,
    },
  });
};

export const verifyController = async (req: Request, res: Response): Promise<void> => {
  const { address, signature } = req.body as { address: string; signature: string };
  console.log("[AUTH_DEBUG][BACKEND][verify] request", {
    address,
    signatureLength: signature?.length ?? 0,
    ip: getIpAddress(req),
  });

  try {
    const result = await verifyWalletSignature(address, signature);

    await logActivity({
      userId: result.user.id,
      action: "LOGIN_SUCCESS",
      metadata: { walletAddress: result.user.walletAddress },
      ipAddress: getIpAddress(req),
    });

    console.log("[AUTH_DEBUG][BACKEND][verify] setting cookie", {
      cookieName: env.AUTH_COOKIE_NAME,
      domain: ".apollonft.io",
sameSite: "lax",
secure: true,
      tokenPreview: maskToken(result.token),
      userId: result.user.id,
      role: result.user.role,
    });

    res.cookie(env.AUTH_COOKIE_NAME, result.token, authCookieOptions);
    res.status(200).json({
      success: true,
      message: "Login successful",
      data: {
        token: result.token,
        user: result.user,
      },
    });
  } catch (error) {
    console.log("[AUTH_DEBUG][BACKEND][verify] failed", {
      address,
      error: error instanceof Error ? error.message : "unknown",
    });
    const user = await prisma.user.findFirst({
      where: {
        walletAddress: {
          equals: address.trim(),
          mode: "insensitive",
        },
      },
      select: { id: true },
    });

    if (user) {
      await logActivity({
        userId: user.id,
        action: "LOGIN_FAILED",
        metadata: { walletAddress: address },
        ipAddress: getIpAddress(req),
      });
    }

    throw error;
  }
};

export const logoutController = async (_req: Request, res: Response): Promise<void> => {
  console.log("[AUTH_DEBUG][BACKEND][logout] clear cookie", {
    cookieName: env.AUTH_COOKIE_NAME,
    sameSite: "lax" as const,
    secure: true,
  });
  res.clearCookie(env.AUTH_COOKIE_NAME, {
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
  });

  res.status(200).json({
    success: true,
    message: "Logout successful",
  });
};

export const meController = async (req: Request, res: Response): Promise<void> => {
  const authUser = req.authUser;
  console.log("[AUTH_DEBUG][BACKEND][me] authUser", authUser);

  if (!authUser) {
    throw new HttpError(401, "Authentication required", "AUTH_REQUIRED");
  }

  const user = await prisma.user.findUnique({
    where: { id: authUser.userId },
    select: {
      id: true,
      walletAddress: true,
      role: true,
      name: true,
      avatarUrl: true,
      isBlocked: true,
    },
  });

  if (!user || user.isBlocked) {
    throw new HttpError(401, "Invalid session", "INVALID_SESSION");
  }

  res.status(200).json({
    success: true,
    message: "Session valid",
    data: user,
  });
};
