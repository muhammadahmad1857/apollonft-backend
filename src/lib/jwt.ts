import jwt, { type JwtPayload, type SignOptions } from "jsonwebtoken";
import { env } from "../config/env";

export type AuthTokenPayload = {
  userId: number;
  walletAddress: string;
  role: string;
};

export const signAuthToken = (payload: AuthTokenPayload): string => {
  const options: SignOptions = {
    expiresIn: env.JWT_EXPIRES_IN as SignOptions["expiresIn"],
  };

  return jwt.sign(payload, env.JWT_SECRET, options);
};

export const verifyAuthToken = (token: string): AuthTokenPayload => {
  const decoded = jwt.verify(token, env.JWT_SECRET) as JwtPayload;

  if (
    typeof decoded.userId !== "number" ||
    typeof decoded.walletAddress !== "string" ||
    typeof decoded.role !== "string"
  ) {
    throw new Error("Invalid token payload");
  }

  return {
    userId: decoded.userId,
    walletAddress: decoded.walletAddress,
    role: decoded.role,
  };
};
