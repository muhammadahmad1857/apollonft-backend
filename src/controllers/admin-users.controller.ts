import type { Request, Response } from "express";
import { UserRole } from "../generated/prisma/enums";
import { HttpError } from "../lib/http-error";
import { prisma } from "../lib/prisma";
import { logActivity } from "../services/activity-log.service";

const getIpAddress = (req: Request): string | null => {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    return forwarded.split(",")[0]?.trim() ?? null;
  }
  return req.ip ?? null;
};

export const listUsersController = async (req: Request, res: Response): Promise<void> => {
  const q = typeof req.query.q === "string" ? req.query.q : undefined;
  const role = typeof req.query.role === "string" ? (req.query.role as UserRole) : undefined;
  const blocked = typeof req.query.blocked === "string" ? req.query.blocked : undefined;
  const page = Number(req.query.page ?? 1);
  const pageSize = Number(req.query.pageSize ?? 10);

  const whereClause = {
    ...(q
      ? {
          OR: [
            { walletAddress: { contains: q, mode: "insensitive" as const } },
            { name: { contains: q, mode: "insensitive" as const } },
            { email: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
    ...(role ? { role } : {}),
    ...(blocked === "true" ? { isBlocked: true } : {}),
    ...(blocked === "false" ? { isBlocked: false } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.user.findMany({
      where: whereClause,
      select: {
        id: true,
        walletAddress: true,
        name: true,
        avatarUrl: true,
        role: true,
        isBlocked: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.user.count({ where: whereClause }),
  ]);

  res.status(200).json({
    success: true,
    message: "Users fetched",
    data: {
      items,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    },
  });
};

export const getUserController = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);

  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      walletAddress: true,
      name: true,
      email: true,
      avatarUrl: true,
      role: true,
      isBlocked: true,
      createdAt: true,
      updatedAt: true,
      lastLoginAt: true,
    },
  });

  if (!user) {
    throw new HttpError(404, "User not found", "USER_NOT_FOUND");
  }

  res.status(200).json({
    success: true,
    message: "User fetched",
    data: user,
  });
};

export const blockUserController = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  const { isBlocked } = req.body as { isBlocked: boolean };

  const user = await prisma.user.findUnique({ where: { id }, select: { id: true, isBlocked: true } });
  if (!user) {
    throw new HttpError(404, "User not found", "USER_NOT_FOUND");
  }

  const updated = await prisma.user.update({
    where: { id },
    data: { isBlocked },
    select: { id: true, walletAddress: true, name: true, role: true, isBlocked: true },
  });

  await logActivity({
    userId: req.authUser!.userId,
    action: isBlocked ? "BLOCK_USER" : "UNBLOCK_USER",
    metadata: { targetUserId: id, previousBlocked: user.isBlocked, nextBlocked: isBlocked },
    ipAddress: getIpAddress(req),
  });

  res.status(200).json({
    success: true,
    message: isBlocked ? "User blocked" : "User unblocked",
    data: updated,
  });
};

export const changeRoleController = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  const { role } = req.body as { role: UserRole };

  const user = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true } });
  if (!user) {
    throw new HttpError(404, "User not found", "USER_NOT_FOUND");
  }

  if (req.authUser?.userId === id && role !== UserRole.SUPER_ADMIN) {
    throw new HttpError(400, "Super admin cannot self-demote", "SELF_DEMOTE_BLOCKED");
  }

  if (user.role === UserRole.SUPER_ADMIN && role !== UserRole.SUPER_ADMIN) {
    const superAdminCount = await prisma.user.count({ where: { role: UserRole.SUPER_ADMIN } });
    if (superAdminCount <= 1) {
      throw new HttpError(400, "Cannot demote the last super admin", "LAST_SUPER_ADMIN_BLOCKED");
    }
  }

  const updated = await prisma.user.update({
    where: { id },
    data: { role },
    select: { id: true, walletAddress: true, name: true, role: true, isBlocked: true },
  });

  await logActivity({
    userId: req.authUser!.userId,
    action: "CHANGE_ROLE",
    metadata: { targetUserId: id, previousRole: user.role, nextRole: role },
    ipAddress: getIpAddress(req),
  });

  res.status(200).json({
    success: true,
    message: "User role updated",
    data: updated,
  });
};

export const userActivityController = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  const page = Number(req.query.page ?? 1);
  const pageSize = Number(req.query.pageSize ?? 20);

  const [items, total] = await Promise.all([
    prisma.activityLog.findMany({
      where: { userId: id },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        action: true,
        metadata: true,
        ipAddress: true,
        createdAt: true,
      },
    }),
    prisma.activityLog.count({ where: { userId: id } }),
  ]);

  res.status(200).json({
    success: true,
    message: "Activity fetched",
    data: {
      items,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    },
  });
};
