import { Router } from "express";
import { adminRouter } from "./admin.routes";
import { authRouter } from "./auth.routes";
import { marketplaceRouter } from "./marketplace.routes";
import { notificationsRouter } from "./notifications.routes";

export const apiRouter = Router();

apiRouter.get("/health", (_req, res) => {
  res.status(200).json({
    success: true,
    message: "OK",
  });
});

apiRouter.use("/auth", authRouter);
apiRouter.use("/admin", adminRouter);
apiRouter.use("/notifications", notificationsRouter);
apiRouter.use("/marketplace", marketplaceRouter);
