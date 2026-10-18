import { randomBytes, randomInt } from 'crypto';
import { Types, isValidObjectId } from 'mongoose';
import { config } from '../config';
import { LedgerEntry } from '../models/LedgerEntry';
import { PayoutEntry } from '../models/PayoutEntry';
import { User } from '../models/User';
import { PAYOUT_METHODS, PayoutMethod, WALLET_METHODS, Withdrawal } from '../models/Withdrawal';
import { ApiError } from '../utils/http';
import { isEthiopianMobile, normalizePhone } from '../utils/phone';
import { runAtomic } from './atomic';
import { decryptText, encryptText, hashOtp, safeEqualHex } from './kycCrypto';
import { assertSellerVerified } from './kycService';
import { sendSms } from './sms';

export interface Wallet {
  /** Seller share of paid orders that is still inside the buyer's inspection window. */
  lockedETB: number;
  /** Seller share that has been released (order completed). */
  releasedETB: number;
  /** Asked for and waiting for an admin to pay. */
  pendingETB: number;
  /** Already paid out. */
  paidETB: number;
  /** What can be withdrawn right now. */
  availableETB: number;
  minWithdrawalETB: number;
}

const sum = (rows: { _id: unknown; total: number }[], id: unknown) => rows.find((r) => r._id === id)?.total ?? 0;

/** The balance is always computed from the ledger and the withdrawal list, so it cannot drift. */
export async function getWallet(userId: string): Promise<Wallet> {
  const uid = new Types.ObjectId(userId);
  const [sales, withdrawals] = await Promise.all([
    LedgerEntry.aggregate<{ _id: string; total: number }>([
      { $match: { seller: uid, $or: [{ type: 'seller_release' }, { type: 'seller_escrow', status: 'locked' }] } },
      { $group: { _id: '$type', total: { $sum: '$amountETB' } } },
    ]),
    Withdrawal.aggregate<{ _id: string; total: number }>([
      { $match: { user: uid, status: { $in: ['requested', 'paid'] } } },
      { $group: { _id: '$status', total: { $sum: '$amountETB' } } },
    ]),
  ]);
  const releasedETB = sum(sales, 'seller_release');
  const pendingETB = sum(withdrawals, 'requested');
  const paidETB = sum(withdrawals, 'paid');
  return {
    lockedETB: sum(sales, 'seller_escrow'),
    releasedETB,
    pendingETB,
    paidETB,
    availableETB: Math.max(0, releasedETB - pendingETB - paidETB),
    minWithdrawalETB: config.payout.minETB,
  };
}

// ------------------------------------------------------------------ one-time code

const otpInput = (code: string) => `withdraw:${code}`; // keeps these codes apart from the identity-check codes

interface OtpUser {
  phone: string;
  payoutOtp?: { hash?: string; salt?: string; expiresAt?: Date; attempts?: number; lastSentAt?: Date };
}

/** Sends a 6 digit code to the ACCOUNT phone, which assertSellerVerified has just proved equals the phone linked to the National ID. */
export async function sendWithdrawalCode(userId: string): Promise<{ expiresAt: Date; resendAt: Date }> {
  await assertSellerVerified(userId);
  const u = (await User.findById(userId).select('phone +payoutOtp').lean()) as OtpUser | null;
  if (!u) throw new ApiError(401, 'Please log in to continue');

  const t = Date.now();
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const salt = randomBytes(16).toString('hex');
  const expiresAt = new Date(t + config.payout.otpTtlMs);

  // Guarded by lastSentAt so two simultaneous requests cannot both pass the cooldown.
  const claimed = await User.findOneAndUpdate(
    { _id: userId, $or: [{ 'payoutOtp.lastSentAt': { $exists: false } }, { 'payoutOtp.lastSentAt': { $lte: new Date(t - config.payout.otpResendMs) } }] },
    { $set: { payoutOtp: { hash: hashOtp(userId, salt, otpInput(code)), salt, expiresAt, attempts: 0, lastSentAt: new Date(t) } } },
  );
  if (!claimed) throw new ApiError(429, 'A code was just sent. Wait a minute before asking for another.');

  try {
    await sendSms(u.phone, `Truth Market: code ${code} confirms your withdrawal. Valid 5 minutes. Never share it. / የገንዘብ ማውጫ ኮድዎ ${code} ነው። ለ5 ደቂቃ ይሰራል። ለማንም አያጋሩ።`);
  } catch (e) {
    await User.updateOne({ _id: userId }, { $unset: { payoutOtp: '' } });
    throw e;
  }
  return { expiresAt, resendAt: new Date(t + config.payout.otpResendMs) };
}

/** Counts the try first (atomically), checks the code, then burns it so it works once. */
async function consumeWithdrawalCode(userId: string, code: string): Promise<void> {
  const u = (await User.findOneAndUpdate(
    { _id: userId, 'payoutOtp.attempts': { $lt: config.payout.otpMaxAttempts } },
    { $inc: { 'payoutOtp.attempts': 1 } },
    { new: true },
  ).select('+payoutOtp')) as OtpUser | null;
  if (!u?.payoutOtp?.hash || !u.payoutOtp.salt || !u.payoutOtp.expiresAt) {
    throw new ApiError(409, 'Ask for a confirmation code first (it is sent to your verified phone).');
  }
  const otp = u.payoutOtp;
  if (otp.expiresAt!.getTime() < Date.now()) throw new ApiError(410, 'This code has expired. Ask for a new one.');

  if (!safeEqualHex(otp.hash!, hashOtp(userId, otp.salt!, otpInput(code)))) {
    const left = config.payout.otpMaxAttempts - (otp.attempts ?? 0);
    if (left <= 0) {
      await User.updateOne({ _id: userId }, { $unset: { payoutOtp: '' } });
      throw new ApiError(423, 'Too many wrong codes. Ask for a new code.');
    }
    throw new ApiError(400, `That code is not correct. ${left} ${left === 1 ? 'try' : 'tries'} left.`);
  }
  // Burn it. If a parallel request already used it, this matches nothing.
  const burned = await User.findOneAndUpdate({ _id: userId, 'payoutOtp.hash': otp.hash }, { $unset: { payoutOtp: '' } });
  if (!burned) throw new ApiError(409, 'This code was already used. Ask for a new one.');
}

// ------------------------------------------------------------------ withdrawal

export interface WithdrawalInput {
  amountETB: number;
  method: PayoutMethod;
  accountName: string;
  accountNumber: string;
  code: string;
}

/**
 * Every rule for taking money out, in order:
 *  1. National ID check complete AND account phone still equals the ID-linked phone (else blocked / account flagged);
 *  2. the account details are valid for the chosen bank or wallet;
 *  3. a fresh SMS code sent to that verified phone is correct;
 *  4. the amount is within the released balance. A short lock around steps 4-5 stops two parallel requests from spending the same money.
 */
export async function requestWithdrawal(userId: string, input: WithdrawalInput) {
  await assertSellerVerified(userId);

  if (!(PAYOUT_METHODS as readonly string[]).includes(input.method)) throw new ApiError(400, 'Choose a bank or wallet');
  const isWallet = WALLET_METHODS.includes(input.method);
  let account = input.accountNumber.replace(/[\s-]/g, '');
  if (isWallet) {
    account = normalizePhone(account);
    if (!isEthiopianMobile(account)) throw new ApiError(400, 'Enter the Telebirr / CBE Birr phone number (09xxxxxxxx)');
  } else if (!/^\d{6,20}$/.test(account)) {
    throw new ApiError(400, 'Enter the bank account number (digits only)');
  }
  if (!Number.isInteger(input.amountETB) || input.amountETB < config.payout.minETB) {
    throw new ApiError(400, `The smallest withdrawal is ${config.payout.minETB} ETB (whole birr)`);
  }

  await consumeWithdrawalCode(userId, input.code);

  const now = new Date();
  const locked = await User.findOneAndUpdate(
    { _id: userId, $or: [{ payoutLockUntil: { $exists: false } }, { payoutLockUntil: { $lt: now } }] },
    { $set: { payoutLockUntil: new Date(now.getTime() + 15_000) } },
  );
  if (!locked) throw new ApiError(429, 'Another withdrawal is being processed. Try again in a few seconds.');

  try {
    const w = await getWallet(userId);
    if (input.amountETB > w.availableETB) {
      throw new ApiError(409, `You can withdraw up to ${w.availableETB} ETB right now. Money from a sale unlocks after the buyer's inspection window.`);
    }
    // Re-check the identity rule right before the money is committed.
    await assertSellerVerified(userId);
    // The request and its ledger record are saved together or not at all.
    const doc = await runAtomic(async (session) => {
      const [created] = await Withdrawal.create(
        [{ user: userId, amountETB: input.amountETB, method: input.method, accountName: input.accountName, accountEnc: encryptText(account, userId), accountLast4: account.slice(-4) }],
        { session },
      );
      await PayoutEntry.updateOne(
        { withdrawal: created._id, type: 'withdrawal_requested' },
        { $setOnInsert: { withdrawal: created._id, user: userId, type: 'withdrawal_requested', amountETB: created.amountETB } },
        { upsert: true, session },
      );
      return created;
    });
    return { id: String(doc._id), amountETB: doc.amountETB, status: doc.status };
  } finally {
    await User.updateOne({ _id: userId }, { $unset: { payoutLockUntil: '' } });
  }
}

export async function listOwnWithdrawals(userId: string) {
  const rows = await Withdrawal.find({ user: userId }).sort({ createdAt: -1 }).limit(50).lean();
  return rows.map((r) => ({
    id: String(r._id), amountETB: r.amountETB, method: r.method, accountName: r.accountName, accountLast4: r.accountLast4,
    status: r.status, rejectionReason: r.rejectionReason ?? null, paymentReference: r.paymentReference ?? null,
    createdAt: r.createdAt, decidedAt: r.decidedAt ?? null,
  }));
}

// ------------------------------------------------------------------ admin

export async function adminListWithdrawals(status: 'requested' | 'paid' | 'rejected') {
  const rows = await Withdrawal.find({ status }).select('+accountEnc').sort({ createdAt: 1 }).limit(100).populate('user', 'name phone isVerified kyc.status').lean();
  return rows.map((r) => {
    const u = r.user as unknown as { _id: Types.ObjectId; name: string; phone: string; isVerified?: boolean; kyc?: { status?: string } } | null;
    return {
      id: String(r._id), amountETB: r.amountETB, method: r.method, accountName: r.accountName, accountLast4: r.accountLast4,
      // The full number is shown only to an admin who is about to pay it, and only while it is waiting.
      accountNumber: status === 'requested' && u ? decryptText(r.accountEnc, String(u._id)) : null,
      status: r.status, paymentReference: r.paymentReference ?? null, rejectionReason: r.rejectionReason ?? null, createdAt: r.createdAt,
      seller: u ? { id: String(u._id), name: u.name, phone: u.phone, verified: !!u.isVerified, kycStatus: u.kyc?.status ?? 'none' } : null,
    };
  });
}

/** Paying needs a reference and a seller who is still verified; rejecting needs a reason. Both move one request exactly once. */
export async function adminDecideWithdrawal(adminId: string, id: string, decision: 'paid' | 'reject', text: string) {
  if (!isValidObjectId(id)) throw new ApiError(400, 'Invalid withdrawal id');
  const cur = await Withdrawal.findById(id).select('user status').lean();
  if (!cur) throw new ApiError(404, 'Withdrawal not found');

  const set: Record<string, unknown> = { decidedBy: adminId, decidedAt: new Date() };
  if (decision === 'paid') {
    if (text.trim().length < 3) throw new ApiError(400, 'Enter the transaction reference from the bank or Telebirr');
    // Never pay an account that was put on hold after it asked.
    await assertSellerVerified(String(cur.user)).catch((e) => {
      throw new ApiError(409, `The seller is not verified any more, so this was not paid (${e instanceof ApiError ? e.message : 'check failed'}).`);
    });
    set.status = 'paid';
    set.paymentReference = text.trim().slice(0, 80);
  } else {
    if (text.trim().length < 3) throw new ApiError(400, 'Give the seller a short reason');
    set.status = 'rejected';
    set.rejectionReason = text.trim().slice(0, 300);
  }
  // The decision and its ledger record are saved together. Only one decision can ever match status "requested".
  const done = await runAtomic(async (session) => {
    const d = await Withdrawal.findOneAndUpdate({ _id: id, status: 'requested' }, { $set: set }, { new: true, session });
    if (!d) return null;
    const type = d.status === 'paid' ? 'payout_completed' : 'withdrawal_rejected';
    await PayoutEntry.updateOne(
      { withdrawal: d._id, type },
      { $setOnInsert: { withdrawal: d._id, user: d.user, type, amountETB: d.amountETB, reference: d.paymentReference, by: adminId } },
      { upsert: true, session },
    );
    return d;
  });
  if (!done) throw new ApiError(409, 'This withdrawal was already decided. Refresh the list.');
  return { status: done.status };
}
