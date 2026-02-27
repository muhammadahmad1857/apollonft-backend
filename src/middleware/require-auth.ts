import type { NextFunction, Request, Response } from "express";
import { UserRole } from "../generated/prisma/enums";
import { env } from "../config/env";
import { HttpError } from "../lib/http-error";
import { verifyAuthToken } from "../lib/jwt";

const getTokenFromRequest = (req: Request): string | null => {
  const authHeader = req.headers.authorization;

  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7).trim();
  }

  const cookieToken = req.cookies?.[env.AUTH_COOKIE_NAME];
  if (typeof cookieToken === "string" && cookieToken.length > 0) {
    return cookieToken;
  }

  return null;
};

export const requireAuth = (req: Request, _res: Response, next: NextFunction): void => {
  const token = getTokenFromRequest(req);

  if (!token) {
    next(new HttpError(401, "Authentication required", "AUTH_REQUIRED"));
    return;
  }

  try {
    const payload = verifyAuthToken(token);

    if (!(payload.role in UserRole)) {
      throw new Error("Invalid role");
    }

    req.authUser = {
      userId: payload.userId,
      walletAddress: payload.walletAddress,
      role: payload.role as UserRole,
    };
    next();
  } catch {
    next(new HttpError(401, "Invalid or expired token", "INVALID_TOKEN"));
  }
};
