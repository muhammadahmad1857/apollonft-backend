import type { NextFunction, Request, Response } from "express";
import { UserRole } from "../generated/prisma/enums";
import { env } from "../config/env";
import { HttpError } from "../lib/http-error";
import { verifyAuthToken } from "../lib/jwt";

const maskToken = (token: string | null | undefined): string => {
  if (!token) return "none";
  if (token.length <= 12) return `${token.slice(0, 4)}...(${token.length})`;
  return `${token.slice(0, 8)}...${token.slice(-4)} (${token.length})`;
};

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
  const hasBearer = typeof req.headers.authorization === "string" && req.headers.authorization.startsWith("Bearer ");
  const hasCookie = typeof req.cookies?.[env.AUTH_COOKIE_NAME] === "string";

  const token = getTokenFromRequest(req);
  console.log("[AUTH_DEBUG][BACKEND][requireAuth] token check", {
    method: req.method,
    path: req.path,
    hasBearer,
    hasCookie,
    tokenPreview: maskToken(token),
  });

  if (!token) {
    console.log("[AUTH_DEBUG][BACKEND][requireAuth] reject: missing token");
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
    console.log("[AUTH_DEBUG][BACKEND][requireAuth] token valid", {
      userId: payload.userId,
      walletAddress: payload.walletAddress,
      role: payload.role,
    });
    next();
  } catch {
    console.log("[AUTH_DEBUG][BACKEND][requireAuth] reject: invalid/expired token");
    next(new HttpError(401, "Invalid or expired token", "INVALID_TOKEN"));
  }
};
