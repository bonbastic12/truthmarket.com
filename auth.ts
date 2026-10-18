import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { User } from '../models/User';
import { ApiError } from '../utils/http';

export interface AuthUser {
  id: string;
  role: 'user' | 'admin';
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function signToken(userId: string): string {
  return jwt.sign({ sub: userId }, config.jwtSecret, { expiresIn: 60 * 60 * 24 * 7 });
}

async function resolveUser(req: Request): Promise<AuthUser | null> {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  try {
    const payload = jwt.verify(header.slice(7), config.jwtSecret) as jwt.JwtPayload;
    if (typeof payload.sub !== 'string') return null;
    // The role is always read from the database so a demoted admin loses access immediately.
    const user = await User.findById(payload.sub).select('role').lean();
    if (!user) return null;
    return { id: String(user._id), role: user.role === 'admin' ? 'admin' : 'user' };
  } catch {
    return null;
  }
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const user = await resolveUser(req);
    if (!user) throw new ApiError(401, 'Please log in to continue');
    req.user = user;
    next();
  } catch (e) {
    next(e);
  }
}

export async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const user = await resolveUser(req);
    if (user) req.user = user;
    next();
  } catch (e) {
    next(e);
  }
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (req.user?.role !== 'admin') return next(new ApiError(403, 'Admin access required'));
  next();
}
