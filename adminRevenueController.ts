import { Request, Response } from 'express';
import { z } from 'zod';
import { PERIODS, CSV_COLUMNS, exportTransactions, revenueReport, revenueSummary, searchTransactions, sellerBalances } from '../services/revenueService';
import { getSettingsWithHistory, updateRates } from '../services/settings';
import { asyncHandler } from '../utils/http';
import { toCsv } from '../utils/csv';

const STATUSES = ['PENDING_PAYMENT', 'FUNDS_HELD_IN_ESCROW', 'TRANSFERRED', 'COMPLETED', 'DISPUTED', 'CANCELLED', 'REFUND_REQUIRED', 'REFUNDED'] as const;
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').transform((s) => new Date(`${s}T00:00:00+03:00`)); // Ethiopian time (UTC+3)

const txQuery = z.object({
  q: z.string().trim().max(80).optional(),
  status: z.enum(STATUSES).optional(),
  from: day.optional(),
  to: day.transform((d) => new Date(d.getTime() + 86_400_000 - 1)).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const noStore = (res: Response) => res.setHeader('Cache-Control', 'no-store');

export const summary = asyncHandler(async (_req: Request, res: Response) => {
  noStore(res);
  res.json(await revenueSummary());
});

export const reports = asyncHandler(async (req: Request, res: Response) => {
  noStore(res);
  const period = z.enum(['daily', 'weekly', 'monthly']).default('daily').parse(req.query.period ?? undefined);
  res.json({ period, rows: await revenueReport(period), windowDays: PERIODS[period].defaultDays });
});

export const transactions = asyncHandler(async (req: Request, res: Response) => {
  noStore(res);
  res.json(await searchTransactions(txQuery.parse(req.query)));
});

export const exportCsv = asyncHandler(async (req: Request, res: Response) => {
  noStore(res);
  const { page: _p, limit: _l, ...filter } = txQuery.parse(req.query);
  const rows = await exportTransactions(filter);
  console.log(`Revenue export by admin ${req.user!.id}: ${rows.length} rows`); // who downloaded the private report
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="truthmarket-transactions-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(toCsv(CSV_COLUMNS, rows));
});

export const payables = asyncHandler(async (_req: Request, res: Response) => {
  noStore(res);
  res.json({ items: await sellerBalances() });
});

export const getCommissionSettings = asyncHandler(async (_req: Request, res: Response) => {
  noStore(res);
  res.json(await getSettingsWithHistory());
});

/** Percent in, so the admin types 10 and 5. Stored as basis points (1000 and 500). */
const settingsBody = z.object({
  sellerCommissionPct: z.number().min(0).max(50),
  buyerFeePct: z.number().min(0).max(50),
});

export const putCommissionSettings = asyncHandler(async (req: Request, res: Response) => {
  const b = settingsBody.parse(req.body);
  await updateRates(req.user!.id, { sellerCommissionBps: Math.round(b.sellerCommissionPct * 100), buyerFeeBps: Math.round(b.buyerFeePct * 100) });
  res.json(await getSettingsWithHistory());
});
