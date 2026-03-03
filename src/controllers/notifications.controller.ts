import type { Request, Response } from "express";
import { HttpError } from "../lib/http-error";
import {
  getUnreadNotificationCount,
  listNotificationsByWallet,
  markAllNotificationsReadByWallet,
  markNotificationReadByWallet,
} from "../services/notification.service";
import { subscribeNotificationStream } from "../services/notification-stream.service";

export const listNotificationsController = async (req: Request, res: Response): Promise<void> => {
  const walletAddress = String(req.query.wallet);
  const page = Number(req.query.page ?? 1);
  const pageSize = Number(req.query.pageSize ?? 20);

  const data = await listNotificationsByWallet({
    walletAddress,
    page,
    pageSize,
  });

  res.status(200).json({
    success: true,
    message: "Notifications fetched",
    data,
  });
};

export const unreadNotificationCountController = async (req: Request, res: Response): Promise<void> => {
  const walletAddress = String(req.query.wallet);
  const unread = await getUnreadNotificationCount(walletAddress);

  res.status(200).json({
    success: true,
    message: "Unread notification count fetched",
    data: {
      unread,
    },
  });
};

export const markNotificationReadController = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  const walletAddress = String(req.query.wallet);

  const updated = await markNotificationReadByWallet(id, walletAddress);
  if (!updated) {
    throw new HttpError(404, "Notification not found", "NOTIFICATION_NOT_FOUND");
  }

  res.status(200).json({
    success: true,
    message: "Notification marked as read",
    data: updated,
  });
};

export const markAllNotificationsReadController = async (req: Request, res: Response): Promise<void> => {
  const walletAddress = String(req.query.wallet);
  const updatedCount = await markAllNotificationsReadByWallet(walletAddress);

  res.status(200).json({
    success: true,
    message: "Notifications marked as read",
    data: {
      updatedCount,
    },
  });
};

export const streamNotificationsController = async (req: Request, res: Response): Promise<void> => {
  const walletAddress = String(req.query.wallet);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const heartbeat = setInterval(() => {
    res.write("event: ping\n");
    res.write(`data: ${JSON.stringify({ timestamp: Date.now() })}\n\n`);
  }, 25000);

  const unsubscribe = subscribeNotificationStream(walletAddress, res);

  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
    res.end();
  });
};
