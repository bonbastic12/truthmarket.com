import { NextFunction, Request, Response } from 'express';
import { assertSellerVerified } from '../services/kycService';

/**
 * Put after requireAuth on any route a seller needs (creating a listing, reporting a handover).
 * It blocks with 403 and a machine readable code in `details`:
 *   KYC_REQUIRED       no completed identity check yet
 *   KYC_PHONE_MISMATCH the account phone does not equal the phone linked to the National ID (account is flagged, isVerified false)
 *   KYC_FLAGGED        the account is on hold
 */
export async function requireKyc(req: Request, _res: Response, next: NextFunction) {
  try {
    await assertSellerVerified(req.user!.id);
    next();
  } catch (e) {
    next(e);
  }
}
