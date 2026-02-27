import { Router } from "express";
import { getNonceController, logoutController, meController, verifyController } from "../controllers/auth.controller";
import { asyncHandler } from "../middleware/async-handler";
import { requireAdmin } from "../middleware/require-admin";
import { requireAuth } from "../middleware/require-auth";
import { validate } from "../middleware/validate";
import { getNonceSchema, verifySignatureSchema } from "../validators/auth.validators";

export const authRouter = Router();

authRouter.get("/nonce", validate(getNonceSchema), asyncHandler(getNonceController));
authRouter.post("/verify", validate(verifySignatureSchema), asyncHandler(verifyController));
authRouter.get("/me", requireAuth, asyncHandler(requireAdmin), asyncHandler(meController));
authRouter.post("/logout", asyncHandler(logoutController));
