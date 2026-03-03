import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { env } from "./config/env";
import { errorHandler, notFoundHandler } from "./middleware/error-handler";
import { apiRouter } from "./routes";

export const app = express();
const allowedOrigins = env.FRONTEND_ORIGINS;

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  }),
);
app.set("trust proxy", true);

app.use(express.json());
app.use(cookieParser());

app.use(apiRouter);
app.use(notFoundHandler);
app.use(errorHandler);
