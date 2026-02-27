import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";

export const validate = (schema: ZodType) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    schema.parse({
      body: req.body,
      query: req.query,
      params: req.params,
    });
    next();
  };
};
