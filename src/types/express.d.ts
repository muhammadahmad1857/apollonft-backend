import type { UserRole } from "../generated/prisma/enums";

declare global {
  namespace Express {
    interface Request {
      authUser?: {
        userId: number;
        walletAddress: string;
        role: UserRole;
      };
    }
  }
}

export {};
