import { randomBytes, randomInt } from 'crypto';
import { isValidObjectId } from 'mongoose';
import { config } from '../config';
import { KycStatus, User } from '../models/User';
import { ApiError } from '../utils/http';
import { isEthiopianMobile, normalizePhone } from '../utils/phone';
import { decryptText, deleteImage, encryptText, hashIdNumber, hashOtp, loadImage, parseImageDataUrl, safeEqualHex, storeImage } from './kycCrypto';
import { sendSms } from './sms';

const now = () => new Date();
const audit = (action: string, by?: string, note?: string) => ({ action, by, note, at: now() });

/** Typed view of the parts of the user we read here. */
interface KycUser {
  _id: unknown;
  phone: string;
  role: string;
  isVerified?: boolean;
  kyc: {
    status: KycStatus;
    idPhone?: string;
    idLast4?: string;
    fullNameOnId?: string;
    idNumberEnc?: string;
    image?: { file?: string; mime?: string; bytes?: number };
    otp?: { hash?: string; salt?: string; expiresAt?: Date; attempts?: number; lastSentAt?: Date; windowStart?: Date; sendCount?: number; verifiedAt?: Date };
    submittedAt?: Date;
    rejectionReason?: string;
    flags?: { code: string; note?: string; at: Date }[];
  };
}

/** Blocks the account straight away. Only an admin can clear it. */
export async function flagUser(userId: string, code: string, note: string): Promise<void> {
  await User.updateOne(
    { _id: userId },
    {
      $set: { isVerified: false, verifiedSeller: false, 'kyc.status': 'flagged' },
      $push: {
        'kyc.flags': { $each: [{ code, note, at: now() }], $slice: -20 },
        'kyc.audit': { $each: [audit('flagged', undefined, `${code}: ${note}`)], $slice: -50 },
      },
    },
  );
}

/**
 * The one rule behind every seller action (creating a listing, reporting a handover):
 * the identity check must be complete AND the phone on the account must still equal the phone linked to the ID.
 * If the phone changed, the account is flagged on the spot.
 */
export async function assertSellerVerified(userId: string): Promise<void> {
  const u = (await User.findById(userId).select('phone isVerified kyc.status kyc.idPhone').lean()) as KycUser | null;
  if (!u) throw new ApiError(401, 'Please log in to continue');
  const status = u.kyc?.status ?? 'none';

  if (status === 'flagged') {
    throw new ApiError(403, 'Your account is on hold for identity review. Contact support if you think this is a mistake.', { code: 'KYC_FLAGGED', kycStatus: status });
  }
  if (!u.isVerified || status !== 'verified') {
    throw new ApiError(403, 'Verify your National ID and phone number before you sell.', { code: 'KYC_REQUIRED', kycStatus: status });
  }
  if (!u.kyc.idPhone || u.kyc.idPhone !== u.phone) {
    await flagUser(userId, 'phone_mismatch', 'Account phone no longer matches the phone linked to the National ID');
    throw new ApiError(403, 'The phone number on your account does not match your National ID. Your account is on hold for review.', { code: 'KYC_PHONE_MISMATCH', kycStatus: 'flagged' });
  }
}

export interface SubmitInput {
  fullName: string;
  idNumber: string;
  idPhone: string;
  imageDataUrl: string;
}

/**
 * Step 1. Stores the ID (encrypted), then runs the automatic checks:
 *  - the phone linked to the ID must equal the account phone, otherwise the account is flagged;
 *  - the same ID number must not already belong to another person's account, otherwise flagged.
 * If both pass, a code is sent by SMS to that phone.
 */
export async function submitKyc(userId: string, input: SubmitInput): Promise<{ status: KycStatus; otpSent: boolean; reason?: string }> {
  const user = (await User.findById(userId).select('phone +kyc.image kyc.status').lean()) as KycUser | null;
  if (!user) throw new ApiError(401, 'Please log in to continue');
  const current = user.kyc?.status ?? 'none';
  if (current === 'verified') throw new ApiError(409, 'Your identity is already verified');
  if (current === 'pending_review') throw new ApiError(409, 'Your documents are already waiting for review');
  if (current === 'flagged') throw new ApiError(403, 'Your account is on hold for identity review. Contact support.');

  if (!config.kyc.idNumberPattern.test(input.idNumber)) throw new ApiError(400, 'Enter your National ID number exactly as printed (digits only)');
  const idPhone = normalizePhone(input.idPhone);
  if (!isEthiopianMobile(idPhone)) throw new ApiError(400, 'Enter a valid Ethiopian phone number');
  const { bytes, mime } = parseImageDataUrl(input.imageDataUrl);

  const idHash = hashIdNumber(input.idNumber);
  const duplicate = await User.exists({
    _id: { $ne: userId },
    'kyc.idNumberHash': idHash,
    'kyc.status': { $in: ['otp_pending', 'pending_review', 'verified', 'flagged'] },
  });

  // Replace any earlier (unfinished or rejected) submission.
  const oldFile = user.kyc?.image?.file;
  const file = await storeImage(bytes, userId);

  const flags: { code: string; note: string; at: Date }[] = [];
  if (idPhone !== user.phone) flags.push({ code: 'phone_mismatch', note: 'Phone linked to the National ID differs from the account phone', at: now() });
  if (duplicate) flags.push({ code: 'duplicate_identity', note: 'This National ID number is already used by another account', at: now() });
  const status: KycStatus = flags.length ? 'flagged' : 'otp_pending';

  await User.updateOne(
    { _id: userId },
    {
      $set: {
        isVerified: false,
        verifiedSeller: false,
        'kyc.status': status,
        'kyc.fullNameOnId': input.fullName,
        'kyc.idNumberEnc': encryptText(input.idNumber, userId),
        'kyc.idNumberHash': idHash,
        'kyc.idLast4': input.idNumber.slice(-4),
        'kyc.idPhone': idPhone,
        'kyc.image': { file, mime, bytes: bytes.length },
        'kyc.submittedAt': now(),
        'kyc.otp': { attempts: 0, sendCount: 0 },
      },
      $unset: { 'kyc.rejectionReason': '', 'kyc.reviewedAt': '', 'kyc.reviewedBy': '' },
      ...(flags.length ? { $push: { 'kyc.flags': { $each: flags, $slice: -20 }, 'kyc.audit': { $each: [audit('flagged', undefined, flags.map((f) => f.code).join(','))], $slice: -50 } } } : { $push: { 'kyc.audit': { $each: [audit('submitted')], $slice: -50 } } }),
    },
  );
  await deleteImage(oldFile);

  if (flags.length) {
    return { status, otpSent: false, reason: 'We could not match these details to your account. Your account is on hold and our team will review it.' };
  }
  try {
    await sendOtp(userId);
    return { status, otpSent: true };
  } catch {
    // The documents are saved; the user can press "Send code" again.
    return { status, otpSent: false };
  }
}

/** Step 2a. Sends a 6 digit code to the phone linked to the ID (which has been checked to equal the account phone). */
export async function sendOtp(userId: string): Promise<{ expiresAt: Date; resendAt: Date }> {
  const u = (await User.findById(userId).select('phone kyc.status kyc.idPhone kyc.otp.lastSentAt kyc.otp.windowStart kyc.otp.sendCount').lean()) as KycUser | null;
  if (!u) throw new ApiError(401, 'Please log in to continue');
  if (u.kyc?.status !== 'otp_pending' || !u.kyc.idPhone) throw new ApiError(409, 'Submit your National ID first');
  if (u.kyc.idPhone !== u.phone) {
    await flagUser(userId, 'phone_mismatch', 'Account phone changed during verification');
    throw new ApiError(403, 'The phone number on your account does not match your National ID. Your account is on hold for review.');
  }

  const t = Date.now();
  const last = u.kyc.otp?.lastSentAt?.getTime() ?? 0;
  if (t - last < config.kyc.otpResendMs) {
    throw new ApiError(429, `Wait ${Math.ceil((config.kyc.otpResendMs - (t - last)) / 1000)} seconds before asking for another code.`);
  }
  const windowStart = u.kyc.otp?.windowStart?.getTime() ?? 0;
  const inWindow = t - windowStart < 3_600_000;
  const sent = inWindow ? u.kyc.otp?.sendCount ?? 0 : 0;
  if (sent >= config.kyc.otpMaxSendsPerHour) throw new ApiError(429, 'Too many codes requested. Try again in an hour.');

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const salt = randomBytes(16).toString('hex');
  const expiresAt = new Date(t + config.kyc.otpTtlMs);

  // Guarded by lastSentAt so two simultaneous requests cannot both pass the cooldown.
  const claimed = await User.findOneAndUpdate(
    {
      _id: userId,
      'kyc.status': 'otp_pending',
      $or: [{ 'kyc.otp.lastSentAt': { $exists: false } }, { 'kyc.otp.lastSentAt': { $lte: new Date(t - config.kyc.otpResendMs) } }],
    },
    {
      $set: {
        'kyc.otp.hash': hashOtp(userId, salt, code),
        'kyc.otp.salt': salt,
        'kyc.otp.expiresAt': expiresAt,
        'kyc.otp.attempts': 0,
        'kyc.otp.lastSentAt': new Date(t),
        'kyc.otp.windowStart': inWindow ? new Date(windowStart) : new Date(t),
        'kyc.otp.sendCount': sent + 1,
      },
    },
  );
  if (!claimed) throw new ApiError(429, 'A code was just sent. Wait a minute before asking for another.');

  try {
    await sendSms(u.kyc.idPhone, `Truth Market: your verification code is ${code}. It works for 5 minutes. Never share it with anyone. / የማረጋገጫ ኮድዎ ${code} ነው። ለ5 ደቂቃ ይሰራል። ለማንም አያጋሩ።`);
  } catch (e) {
    await User.updateOne({ _id: userId }, { $unset: { 'kyc.otp.lastSentAt': '', 'kyc.otp.hash': '', 'kyc.otp.salt': '' } });
    throw e;
  }
  return { expiresAt, resendAt: new Date(t + config.kyc.otpResendMs) };
}

/** Step 2b. Checks the code. Five wrong tries flag the account. */
export async function verifyOtp(userId: string, code: string): Promise<{ status: KycStatus }> {
  // Count the attempt first and atomically, so parallel guesses cannot beat the limit.
  const u = (await User.findOneAndUpdate(
    { _id: userId, 'kyc.status': 'otp_pending', 'kyc.otp.attempts': { $lt: config.kyc.otpMaxAttempts } },
    { $inc: { 'kyc.otp.attempts': 1 } },
    { new: true },
  ).select('+kyc.otp.hash +kyc.otp.salt phone kyc.status kyc.idPhone kyc.otp.attempts kyc.otp.expiresAt')) as KycUser | null;

  if (!u) {
    const cur = (await User.findById(userId).select('kyc.status kyc.otp.attempts').lean()) as KycUser | null;
    if (cur?.kyc?.status === 'otp_pending') {
      await flagUser(userId, 'otp_attempts', 'Too many wrong verification codes');
      throw new ApiError(423, 'Too many wrong codes. Your account is on hold for review.');
    }
    throw new ApiError(409, 'There is no code to check. Submit your National ID first.');
  }
  if (u.kyc.idPhone !== u.phone) {
    await flagUser(userId, 'phone_mismatch', 'Account phone changed during verification');
    throw new ApiError(403, 'The phone number on your account does not match your National ID. Your account is on hold for review.');
  }
  const otp = u.kyc.otp;
  if (!otp?.hash || !otp.salt || !otp.expiresAt || otp.expiresAt.getTime() < Date.now()) {
    throw new ApiError(410, 'This code has expired. Ask for a new one.');
  }

  if (!safeEqualHex(otp.hash, hashOtp(userId, otp.salt, code))) {
    const left = config.kyc.otpMaxAttempts - (otp.attempts ?? 0);
    if (left <= 0) {
      await flagUser(userId, 'otp_attempts', 'Too many wrong verification codes');
      throw new ApiError(423, 'Too many wrong codes. Your account is on hold for review.');
    }
    throw new ApiError(400, `That code is not correct. ${left} ${left === 1 ? 'try' : 'tries'} left.`);
  }

  const done = await User.findOneAndUpdate(
    { _id: userId, 'kyc.status': 'otp_pending' },
    {
      $set: { 'kyc.status': 'pending_review', 'kyc.otp.verifiedAt': now() },
      $unset: { 'kyc.otp.hash': '', 'kyc.otp.salt': '', 'kyc.otp.expiresAt': '' },
      $push: { 'kyc.audit': { $each: [audit('otp_verified')], $slice: -50 } },
    },
    { new: true },
  );
  if (!done) throw new ApiError(409, 'Your verification state changed. Refresh and try again.');
  return { status: 'pending_review' };
}

export type Decision = 'approve' | 'reject' | 'reset';

/** Admin outcome. Approve needs a passed OTP and a phone that still matches. Reject and reset delete the stored ID data. */
export async function decideKyc(adminId: string, userId: string, decision: Decision, reason?: string): Promise<KycStatus> {
  if (!isValidObjectId(userId)) throw new ApiError(400, 'Invalid user id');
  const u = (await User.findById(userId).select('+kyc.image phone isVerified kyc.status kyc.idPhone kyc.otp.verifiedAt').lean()) as KycUser | null;
  if (!u) throw new ApiError(404, 'User not found');
  const status = u.kyc?.status ?? 'none';

  if (decision === 'approve') {
    if (status !== 'pending_review') throw new ApiError(409, 'Only documents that passed the SMS code can be approved');
    if (!u.kyc.otp?.verifiedAt) throw new ApiError(409, 'The phone code was not verified');
    if (!u.kyc.idPhone || u.kyc.idPhone !== u.phone) {
      await flagUser(userId, 'phone_mismatch', 'Phone mismatch found at approval');
      throw new ApiError(409, 'The account phone does not match the phone linked to the ID. The account was flagged.');
    }
    await User.updateOne(
      { _id: userId, 'kyc.status': 'pending_review' },
      {
        $set: { isVerified: true, verifiedSeller: true, 'kyc.status': 'verified', 'kyc.reviewedAt': now(), 'kyc.reviewedBy': adminId },
        $push: { 'kyc.audit': { $each: [audit('approved', adminId)], $slice: -50 } },
      },
    );
    return 'verified';
  }

  if (decision === 'reject') {
    if (!reason || reason.trim().length < 3) throw new ApiError(400, 'Give a short reason so the user can fix it');
  }
  // reject / reset: remove the ID photo and number, keep only the audit trail.
  await deleteImage(u.kyc.image?.file);
  const next: KycStatus = decision === 'reject' ? 'rejected' : 'none';
  await User.updateOne(
    { _id: userId },
    {
      $set: {
        isVerified: false, verifiedSeller: false, 'kyc.status': next, 'kyc.reviewedAt': now(), 'kyc.reviewedBy': adminId,
        ...(decision === 'reject' ? { 'kyc.rejectionReason': reason!.trim().slice(0, 300) } : {}),
      },
      $unset: { 'kyc.image': '', 'kyc.idNumberEnc': '', 'kyc.idNumberHash': '', 'kyc.otp': '', ...(decision === 'reset' ? { 'kyc.idPhone': '', 'kyc.idLast4': '', 'kyc.fullNameOnId': '', 'kyc.rejectionReason': '' } : {}) },
      $push: { 'kyc.audit': { $each: [audit(decision === 'reject' ? 'rejected' : 'reset', adminId, reason)], $slice: -50 } },
    },
  );
  return next;
}

/** Admin only: the decrypted details for a review. Every view is written to the audit trail. */
export async function openForReview(adminId: string, userId: string) {
  if (!isValidObjectId(userId)) throw new ApiError(400, 'Invalid user id');
  const u = (await User.findById(userId).select('+kyc.idNumberEnc name email phone kyc').lean()) as (KycUser & { name: string; email: string }) | null;
  if (!u || !u.kyc || u.kyc.status === 'none') throw new ApiError(404, 'No identity submission for this user');
  await User.updateOne({ _id: userId }, { $push: { 'kyc.audit': { $each: [audit('viewed', adminId)], $slice: -50 } } });
  return {
    id: String(u._id), name: u.name, email: u.email, accountPhone: u.phone,
    status: u.kyc.status, fullNameOnId: u.kyc.fullNameOnId, idPhone: u.kyc.idPhone,
    idNumber: u.kyc.idNumberEnc ? decryptText(u.kyc.idNumberEnc, userId) : null,
    phoneMatches: u.kyc.idPhone === u.phone, otpVerified: !!u.kyc.otp?.verifiedAt,
    flags: u.kyc.flags ?? [], submittedAt: u.kyc.submittedAt, rejectionReason: u.kyc.rejectionReason,
  };
}

export async function readReviewImage(adminId: string, userId: string): Promise<{ bytes: Buffer; mime: string }> {
  if (!isValidObjectId(userId)) throw new ApiError(400, 'Invalid user id');
  const u = (await User.findById(userId).select('+kyc.image').lean()) as KycUser | null;
  const img = u?.kyc?.image;
  if (!img?.file) throw new ApiError(404, 'No ID photo stored for this user');
  await User.updateOne({ _id: userId }, { $push: { 'kyc.audit': { $each: [audit('viewed_image', adminId)], $slice: -50 } } });
  return { bytes: await loadImage(img.file, userId), mime: img.mime ?? 'image/jpeg' };
}
