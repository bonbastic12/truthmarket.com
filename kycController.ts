import { Request, Response } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { User } from '../models/User';
import { decideKyc, openForReview, readReviewImage, sendOtp, submitKyc, verifyOtp } from '../services/kycService';
import { ApiError, asyncHandler } from '../utils/http';
import { maskPhone } from '../utils/phone';

const submitSchema = z.object({
  fullName: z.string().trim().min(3, 'Enter your full name as printed on the ID').max(120),
  idNumber: z.string().transform((s) => s.replace(/[\s-]/g, '')),
  idPhone: z.string().trim().min(9).max(20),
  // JPEG or PNG as a data URL. The size limits are enforced on the decoded bytes.
  imageDataUrl: z.string().max(9_000_000),
});

/** What the signed-in user may know about their own check. Never includes the ID number or the photo. */
async function ownStatus(userId: string) {
  const u = await User.findById(userId).select('isVerified kyc.status kyc.idLast4 kyc.idPhone kyc.fullNameOnId kyc.submittedAt kyc.rejectionReason kyc.otp.expiresAt kyc.otp.lastSentAt').lean();
  if (!u) throw new ApiError(401, 'Please log in to continue');
  const k = (u.kyc ?? {}) as {
    status?: string; idLast4?: string; idPhone?: string; fullNameOnId?: string; submittedAt?: Date; rejectionReason?: string;
    otp?: { expiresAt?: Date; lastSentAt?: Date };
  };
  return {
    status: k.status ?? 'none',
    isVerified: !!u.isVerified,
    idLast4: k.idLast4 ?? null,
    fullNameOnId: k.fullNameOnId ?? null,
    phone: k.idPhone ? maskPhone(k.idPhone) : null,
    submittedAt: k.submittedAt ?? null,
    rejectionReason: k.rejectionReason ?? null,
    otpExpiresAt: k.otp?.expiresAt ?? null,
    resendAt: k.otp?.lastSentAt ? new Date(k.otp.lastSentAt.getTime() + config.kyc.otpResendMs) : null,
  };
}

export const getStatus = asyncHandler(async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(await ownStatus(req.user!.id));
});

export const submit = asyncHandler(async (req: Request, res: Response) => {
  const body = submitSchema.parse(req.body);
  const result = await submitKyc(req.user!.id, body);
  res.setHeader('Cache-Control', 'no-store');
  res.status(result.status === 'flagged' ? 200 : 201).json({ ...result, kyc: await ownStatus(req.user!.id) });
});

export const sendCode = asyncHandler(async (req: Request, res: Response) => {
  const r = await sendOtp(req.user!.id);
  res.json({ sent: true, expiresAt: r.expiresAt, resendAt: r.resendAt });
});

export const checkCode = asyncHandler(async (req: Request, res: Response) => {
  const { code } = z.object({ code: z.string().regex(/^\d{6}$/, 'The code has 6 digits') }).parse(req.body);
  await verifyOtp(req.user!.id, code);
  res.json({ kyc: await ownStatus(req.user!.id) });
});

// ---------------------------------------------------------------- admin

/** GET /api/kyc/admin/queue?status=pending_review|flagged|verified|rejected */
export const adminQueue = asyncHandler(async (req: Request, res: Response) => {
  const status = z.enum(['pending_review', 'flagged', 'verified', 'rejected', 'otp_pending']).default('pending_review').parse(req.query.status ?? undefined);
  const users = await User.find({ 'kyc.status': status })
    .select('name email phone kyc.status kyc.idLast4 kyc.idPhone kyc.fullNameOnId kyc.flags kyc.submittedAt')
    .sort({ 'kyc.submittedAt': 1 })
    .limit(100)
    .lean();
  res.json({
    items: users.map((u) => ({
      id: String(u._id), name: u.name, email: u.email, accountPhone: u.phone,
      idPhone: u.kyc?.idPhone, phoneMatches: u.kyc?.idPhone === u.phone, idLast4: u.kyc?.idLast4,
      fullNameOnId: u.kyc?.fullNameOnId, flags: u.kyc?.flags ?? [], submittedAt: u.kyc?.submittedAt, status: u.kyc?.status,
    })),
  });
});

export const adminDetail = asyncHandler(async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ review: await openForReview(req.user!.id, req.params.userId) });
});

export const adminImage = asyncHandler(async (req: Request, res: Response) => {
  const { bytes, mime } = await readReviewImage(req.user!.id, req.params.userId);
  res.setHeader('Content-Type', mime);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', 'inline');
  res.send(bytes);
});

export const adminDecision = asyncHandler(async (req: Request, res: Response) => {
  const body = z.object({ decision: z.enum(['approve', 'reject', 'reset']), reason: z.string().trim().max(300).optional() }).parse(req.body);
  const status = await decideKyc(req.user!.id, req.params.userId, body.decision, body.reason);
  res.json({ status });
});
