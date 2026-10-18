import { Request, Response } from 'express';
import { z } from 'zod';
import { PAYOUT_METHODS } from '../models/Withdrawal';
import { adminDecideWithdrawal, adminListWithdrawals, getWallet, listOwnWithdrawals, requestWithdrawal, sendWithdrawalCode } from '../services/payoutService';
import { sellerEarnings } from '../services/earningsService';
import { asyncHandler } from '../utils/http';

const withdrawSchema = z.object({
  amountETB: z.number().int('Whole birr only').positive(),
  method: z.enum(PAYOUT_METHODS),
  accountName: z.string().trim().min(3, 'Enter the name on the account').max(80),
  accountNumber: z.string().trim().min(6).max(24),
  code: z.string().regex(/^\d{6}$/, 'The code has 6 digits'),
});

export const wallet = asyncHandler(async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  const [w, withdrawals] = await Promise.all([getWallet(req.user!.id), listOwnWithdrawals(req.user!.id)]);
  res.json({ wallet: w, withdrawals });
});

export const sendCode = asyncHandler(async (req: Request, res: Response) => {
  const r = await sendWithdrawalCode(req.user!.id);
  res.json({ sent: true, expiresAt: r.expiresAt, resendAt: r.resendAt });
});

export const withdraw = asyncHandler(async (req: Request, res: Response) => {
  const body = withdrawSchema.parse(req.body);
  const created = await requestWithdrawal(req.user!.id, body);
  res.status(201).json({ withdrawal: created, wallet: await getWallet(req.user!.id) });
});

export const adminList = asyncHandler(async (req: Request, res: Response) => {
  const status = z.enum(['requested', 'paid', 'rejected']).default('requested').parse(req.query.status ?? undefined);
  res.setHeader('Cache-Control', 'no-store');
  res.json({ items: await adminListWithdrawals(status) });
});

export const adminDecide = asyncHandler(async (req: Request, res: Response) => {
  const body = z.object({ decision: z.enum(['paid', 'reject']), text: z.string().trim().max(300) }).parse(req.body);
  res.json(await adminDecideWithdrawal(req.user!.id, req.params.id, body.decision, body.text));
});

/** The caller's OWN sales only (price, commission, net, payouts). The id comes from the login token, never from the request. */
export const earnings = asyncHandler(async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(await sellerEarnings(req.user!.id));
});
