import type { NextFunction, Request, Response } from "express";
import { UserRole } from "../generated/prisma/enums";
import { HttpError } from "../lib/http-error";
import { prisma } from "../lib/prisma";

const allowedRoles = new Set<UserRole>([UserRole.ADMIN, UserRole.SUPER_ADMIN]);

export const requireAdmin = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
  if (!req.authUser) {
    next(new HttpError(401, "Authentication required", "AUTH_REQUIRED"));
    return;
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: req.authUser.userId },
    select: { id: true, role: true, isBlocked: true },
  });

  if (!dbUser) {
    next(new HttpError(401, "User not found", "USER_NOT_FOUND"));
    return;
  }

  if (dbUser.isBlocked) {
    next(new HttpError(403, "User is blocked", "USER_BLOCKED"));
    return;
  }

  if (!allowedRoles.has(dbUser.role as UserRole)) {
    next(new HttpError(403, "Admin access required", "ADMIN_ONLY"));
    return;
  }

  req.authUser.role = dbUser.role as UserRole;
  next();
};

export const requireSuperAdmin = (req: Request, _res: Response, next: NextFunction): void => {
  if (!req.authUser || req.authUser.role !== UserRole.SUPER_ADMIN) {
    next(new HttpError(403, "Super admin access required", "SUPER_ADMIN_ONLY"));
    return;
  }

  next();
};
