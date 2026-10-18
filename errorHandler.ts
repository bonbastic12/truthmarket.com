import { NextFunction, Request, Response } from 'express';
import { Error as MongooseError } from 'mongoose';
import { ZodError } from 'zod';
import { config } from '../config';
import { ApiError } from '../utils/http';

export function notFound(req: Request, _res: Response, next: NextFunction) {
  next(new ApiError(404, `Route not found: ${req.method} ${req.originalUrl}`));
}

// Express recognises error middleware by its four arguments.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'Invalid input',
      details: err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    });
  }
  if (err instanceof MongooseError.ValidationError) {
    return res.status(400).json({
      error: 'Invalid input',
      details: Object.values(err.errors).map((e) => ({ field: e.path, message: e.message })),
    });
  }
  if (err instanceof MongooseError.CastError) {
    return res.status(400).json({ error: `Invalid ${err.path}` });
  }
  if (typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000) {
    return res.status(409).json({ error: 'This value already exists' });
  }
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ error: 'Malformed JSON body' });
  }
  console.error(err);
  res.status(500).json({ error: config.isProd ? 'Something went wrong' : String((err as Error)?.message ?? err) });
}
