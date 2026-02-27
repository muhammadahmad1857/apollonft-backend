import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { env } from "./config/env";
import { errorHandler, notFoundHandler } from "./middleware/error-handler";
import { apiRouter } from "./routes";

export const app = express();

app.set("trust proxy", true);
app.use(
  cors({
    origin: env.FRONTEND_ORIGIN,
    credentials: true,
  }),
);
app.use(express.json());
app.use(cookieParser());

app.use(apiRouter);
app.use(notFoundHandler);
app.use(errorHandler);
