import bcrypt from 'bcryptjs';
import { Request, Response } from 'express';
import { z } from 'zod';
import { signToken } from '../middleware/auth';
import { User } from '../models/User';
import { ApiError, asyncHandler } from '../utils/http';
import { isEthiopianMobile, normalizePhone } from '../utils/phone';

const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email().max(120),
  phone: z
    .string()
    .transform(normalizePhone)
    .refine(isEthiopianMobile, 'Enter a valid Ethiopian phone number'),
  password: z
    .string()
    .min(8)
    .max(128)
    .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), 'Password needs a letter and a number'),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(128),
});

function publicUser(u: {
  _id: unknown; name: string; email: string; phone: string; role: string;
  verifiedSeller?: boolean | null; isVerified?: boolean | null; kyc?: { status?: string | null } | null;
}) {
  return {
    id: String(u._id), name: u.name, email: u.email, phone: u.phone, role: u.role,
    verifiedSeller: !!u.verifiedSeller,
    isVerified: !!u.isVerified,
    kycStatus: u.kyc?.status ?? 'none',
  };
}

export const register = asyncHandler(async (req: Request, res: Response) => {
  const body = registerSchema.parse(req.body);
  if (await User.exists({ email: body.email })) throw new ApiError(409, 'An account with this email already exists');
  const passwordHash = await bcrypt.hash(body.password, 12);
  const user = await User.create({ name: body.name, email: body.email, phone: body.phone, passwordHash });
  res.status(201).json({ token: signToken(String(user._id)), user: publicUser(user) });
});

// Hash used to keep login timing the same when the email does not exist.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);

export const login = asyncHandler(async (req: Request, res: Response) => {
  const body = loginSchema.parse(req.body);
  const user = await User.findOne({ email: body.email }).select('+passwordHash');
  const ok = await bcrypt.compare(body.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) throw new ApiError(401, 'Email or password is not correct');
  res.json({ token: signToken(String(user._id)), user: publicUser(user) });
});

export const me = asyncHandler(async (req: Request, res: Response) => {
  const user = await User.findById(req.user!.id);
  if (!user) throw new ApiError(401, 'Please log in to continue');
  res.json({ user: publicUser(user) });
});
