import { Router } from "express";
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
  listUsersSchema,
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
