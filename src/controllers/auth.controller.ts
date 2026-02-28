import type { Request, Response } from "express";
import { env } from "../config/env";
import { HttpError } from "../lib/http-error";
import { prisma } from "../lib/prisma";
import { logActivity } from "../services/activity-log.service";
import { createNonce, verifyWalletSignature } from "../services/auth.service";

const authCookieOptions = {
  httpOnly: true,
  secure: env.AUTH_COOKIE_SECURE,
  sameSite: env.AUTH_COOKIE_SAME_SITE,
  maxAge: 24 * 60 * 60 * 1000,
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
  console.log("Address for nonce:", address);
  const result = await createNonce(address);
  console.log("Nonce result:", result);
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

  try {
    const result = await verifyWalletSignature(address, signature);

    await logActivity({
      userId: result.user.id,
      action: "LOGIN_SUCCESS",
      metadata: { walletAddress: result.user.walletAddress },
      ipAddress: getIpAddress(req),
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
    const user = await prisma.user.findUnique({
      where: { walletAddress: address.toLowerCase() },
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
  res.clearCookie(env.AUTH_COOKIE_NAME, {
    httpOnly: true,
    secure: env.AUTH_COOKIE_SECURE,
    sameSite: env.AUTH_COOKIE_SAME_SITE,
  });

  res.status(200).json({
    success: true,
    message: "Logout successful",
  });
};

export const meController = async (req: Request, res: Response): Promise<void> => {
  const authUser = req.authUser;

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
