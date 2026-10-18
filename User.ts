import { InferSchemaType, Schema, model } from 'mongoose';

export const ROLES = ['user', 'admin'] as const;

/**
 * none -> (submit ID) -> otp_pending -> (code from SMS) -> pending_review -> (admin) -> verified
 * rejected: an admin said no, the user may submit again. flagged: blocked automatically (phone mismatch, duplicate
 * identity, too many wrong codes) and only an admin can clear it.
 */
export const KYC_STATUSES = ['none', 'otp_pending', 'pending_review', 'verified', 'rejected', 'flagged'] as const;
export type KycStatus = (typeof KYC_STATUSES)[number];

const kycSchema = new Schema(
  {
    status: { type: String, enum: KYC_STATUSES, default: 'none' },
    fullNameOnId: { type: String, trim: true, maxlength: 120 },
    /** AES-256-GCM encrypted. Never returned by default and never sent to the browser except to an admin reviewing it. */
    idNumberEnc: { type: String, select: false },
    /** HMAC of the ID number, only used to spot the same ID on two accounts. The number cannot be read back from it. */
    idNumberHash: { type: String, select: false },
    idLast4: { type: String, maxlength: 4 },
    /** The phone number linked to the National ID, normalised to 09xxxxxxxx. Must equal the account phone. */
    idPhone: { type: String, maxlength: 20 },
    /** The ID photo itself is an encrypted file on disk; only its name and type are kept here. */
    image: {
      type: new Schema({ file: String, mime: String, bytes: Number }, { _id: false }),
      select: false,
    },
    otp: {
      hash: { type: String, select: false },
      salt: { type: String, select: false },
      expiresAt: Date,
      attempts: { type: Number, default: 0 },
      lastSentAt: Date,
      windowStart: Date,
      sendCount: { type: Number, default: 0 },
      verifiedAt: Date,
    },
    flags: {
      type: [new Schema({ code: String, note: String, at: Date }, { _id: false })],
      default: [],
    },
    submittedAt: Date,
    reviewedAt: Date,
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    rejectionReason: { type: String, maxlength: 300 },
    /** Who looked at or changed what (newest 50). */
    audit: {
      type: [new Schema({ action: String, by: Schema.Types.ObjectId, note: String, at: Date }, { _id: false })],
      default: [],
    },
  },
  { _id: false },
);

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 120 },
    phone: { type: String, required: true, trim: true, maxlength: 20 },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, default: 'user' },
    /** True only while the National ID check is fully passed. Seller actions need it. */
    isVerified: { type: Boolean, default: false },
    /** Public "Verified seller" badge. Always kept equal to isVerified. */
    verifiedSeller: { type: Boolean, default: false },
    kyc: { type: kycSchema, default: () => ({}) },
    /** One-time code for a withdrawal, sent to the account phone. Hashed, 5 minute life, never returned. */
    payoutOtp: {
      type: new Schema({ hash: String, salt: String, expiresAt: Date, attempts: { type: Number, default: 0 }, lastSentAt: Date }, { _id: false }),
      select: false,
    },
    /** Short lock held while a withdrawal is being checked, so two parallel requests cannot spend the same balance. */
    payoutLockUntil: { type: Date, select: false },
  },
  { timestamps: true },
);

userSchema.index({ role: 1 });
userSchema.index({ phone: 1 });
userSchema.index({ 'kyc.status': 1, 'kyc.submittedAt': 1 });
userSchema.index({ 'kyc.idNumberHash': 1 }, { sparse: true });

export type UserAttrs = InferSchemaType<typeof userSchema>;
export const User = model('User', userSchema);
