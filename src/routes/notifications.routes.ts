import { Router } from "express";
import {
  listNotificationsController,
  markAllNotificationsReadController,
  markNotificationReadController,
  streamNotificationsController,
  unreadNotificationCountController,
} from "../controllers/notifications.controller";
import { asyncHandler } from "../middleware/async-handler";
import { validate } from "../middleware/validate";
import {
  listNotificationsSchema,
  markAllNotificationsReadSchema,
  markNotificationReadSchema,
  streamNotificationsSchema,
  unreadCountSchema,
} from "../validators/notifications.validators";

export const notificationsRouter = Router();

notificationsRouter.get("/", validate(listNotificationsSchema), asyncHandler(listNotificationsController));
notificationsRouter.get(
  "/unread-count",
  validate(unreadCountSchema),
  asyncHandler(unreadNotificationCountController),
);
notificationsRouter.patch(
  "/read-all",
  validate(markAllNotificationsReadSchema),
  asyncHandler(markAllNotificationsReadController),
);
notificationsRouter.patch(
  "/:id/read",
  validate(markNotificationReadSchema),
  asyncHandler(markNotificationReadController),
);
notificationsRouter.get("/stream", validate(streamNotificationsSchema), asyncHandler(streamNotificationsController));
