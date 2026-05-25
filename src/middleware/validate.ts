import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";

export const validate = (schema: ZodType) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    // Preserve transformed values from Zod by assigning parsed output
    // back onto the request object before continuing.
    const parsed = schema.parse({
      body: req.body,
      query: req.query,
      params: req.params,
    }) as any;

    if (parsed && typeof parsed === "object") {
      if (parsed.body !== undefined) req.body = parsed.body;
      if (parsed.query !== undefined) req.query = parsed.query;
      if (parsed.params !== undefined) req.params = parsed.params;
    }

    next();
  };
};
