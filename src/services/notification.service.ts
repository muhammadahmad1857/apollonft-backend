import type { Prisma } from "../generated/prisma/client";
import { prisma } from "../lib/prisma";
import { publishNotificationToWallet } from "./notification-stream.service";

export type NotificationType =
  | "ADMIN_BLOCK_USER"
  | "ADMIN_UNBLOCK_USER"
  | "ADMIN_CHANGE_ROLE"
  | "ADMIN_NFT_STATUS_CHANGED"
  | "ADMIN_NFT_DELISTED"
  | "ADMIN_AUCTION_FROZEN"
  | "ADMIN_AUCTION_UNFROZEN";

type CreateNotificationInput = {
  recipientWalletAddress: string;
  recipientUserId?: number | null;
  actorUserId?: number | null;
  type: NotificationType;
  title: string;
  message: string;
  metadata?: Record<string, unknown> | null;
};

type ListNotificationsInput = {
  walletAddress: string;
  page: number;
  pageSize: number;
};

const normalizeWalletAddress = (walletAddress: string): string => walletAddress.trim().toLowerCase();

export const createNotification = async (input: CreateNotificationInput) => {
  const notification = await prisma.notification.create({
    data: {
      recipientUserId: input.recipientUserId ?? null,
      recipientWalletAddress: normalizeWalletAddress(input.recipientWalletAddress),
      actorUserId: input.actorUserId ?? null,
      type: input.type,
      title: input.title,
      message: input.message,
      metadata: input.metadata as Prisma.InputJsonValue | undefined,
    },
    select: {
      id: true,
      recipientUserId: true,
      recipientWalletAddress: true,
      actorUserId: true,
      type: true,
      title: true,
      message: true,
      metadata: true,
      isRead: true,
      readAt: true,
      createdAt: true,
    },
  });

  publishNotificationToWallet(notification.recipientWalletAddress, notification);

  return notification;
};

export const listNotificationsByWallet = async (input: ListNotificationsInput) => {
  const walletAddress = normalizeWalletAddress(input.walletAddress);

  const [items, total] = await Promise.all([
    prisma.notification.findMany({
      where: { recipientWalletAddress: walletAddress },
      orderBy: { createdAt: "desc" },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
      select: {
        id: true,
        type: true,
        title: true,
        message: true,
        metadata: true,
        isRead: true,
        readAt: true,
        createdAt: true,
      },
    }),
    prisma.notification.count({ where: { recipientWalletAddress: walletAddress } }),
  ]);

  return {
    items,
    pagination: {
      page: input.page,
      pageSize: input.pageSize,
      total,
      totalPages: Math.ceil(total / input.pageSize),
    },
  };
};

export const getUnreadNotificationCount = async (walletAddress: string) => {
  return prisma.notification.count({
    where: {
      recipientWalletAddress: normalizeWalletAddress(walletAddress),
      isRead: false,
    },
  });
};

export const markNotificationReadByWallet = async (id: number, walletAddress: string) => {
  const normalizedWallet = normalizeWalletAddress(walletAddress);
  const existing = await prisma.notification.findFirst({
    where: {
      id,
      recipientWalletAddress: normalizedWallet,
    },
    select: { id: true },
  });

  if (!existing) {
    return null;
  }

  return prisma.notification.update({
    where: { id },
    data: {
      isRead: true,
      readAt: new Date(),
    },
    select: {
      id: true,
      isRead: true,
      readAt: true,
      updatedAt: true,
    },
  });
};

export const markAllNotificationsReadByWallet = async (walletAddress: string) => {
  const result = await prisma.notification.updateMany({
    where: {
      recipientWalletAddress: normalizeWalletAddress(walletAddress),
      isRead: false,
    },
    data: {
      isRead: true,
      readAt: new Date(),
    },
  });

  return result.count;
};
