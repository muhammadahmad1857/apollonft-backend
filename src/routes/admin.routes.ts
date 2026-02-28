import { Router } from "express";
import {
  delistNftController,
  freezeAuctionController,
  getDashboardStatsController,
  listAdminActivityController,
  listAuctionsController,
  listNftsController,
  updateNftStatusController,
} from "../controllers/admin-content.controller";
import {
  blockUserController,
  changeRoleController,
  getUserController,
  listUsersController,
  userActivityController,
} from "../controllers/admin-users.controller";
import { asyncHandler } from "../middleware/async-handler";
import { requireAdmin, requireSuperAdmin } from "../middleware/require-admin";
import { requireAuth } from "../middleware/require-auth";
import { validate } from "../middleware/validate";
import {
  activityQuerySchema,
  blockUserSchema,
  changeRoleSchema,
  dashboardStatsSchema,
  delistNftSchema,
  freezeAuctionSchema,
  listAdminActivitySchema,
  listAuctionsSchema,
  listNftsSchema,
  listUsersSchema,
  updateNftStatusSchema,
  userIdParamSchema,
} from "../validators/admin.validators";

export const adminRouter = Router();

adminRouter.use(requireAuth, asyncHandler(requireAdmin));

adminRouter.get("/users", validate(listUsersSchema), asyncHandler(listUsersController));
adminRouter.get("/users/:id", validate(userIdParamSchema), asyncHandler(getUserController));
adminRouter.patch("/users/:id/block", validate(blockUserSchema), asyncHandler(blockUserController));
adminRouter.patch(
  "/users/:id/role",
  requireSuperAdmin,
  validate(changeRoleSchema),
  asyncHandler(changeRoleController),
);
adminRouter.get("/users/:id/activity", validate(activityQuerySchema), asyncHandler(userActivityController));
adminRouter.get("/stats", validate(dashboardStatsSchema), asyncHandler(getDashboardStatsController));
adminRouter.get("/nfts", validate(listNftsSchema), asyncHandler(listNftsController));
adminRouter.patch("/nfts/:id/status", validate(updateNftStatusSchema), asyncHandler(updateNftStatusController));
adminRouter.post("/nfts/:id/delist", validate(delistNftSchema), asyncHandler(delistNftController));
adminRouter.get("/auctions", validate(listAuctionsSchema), asyncHandler(listAuctionsController));
adminRouter.patch("/auctions/:id/freeze", validate(freezeAuctionSchema), asyncHandler(freezeAuctionController));
adminRouter.get("/activity", validate(listAdminActivitySchema), asyncHandler(listAdminActivityController));
