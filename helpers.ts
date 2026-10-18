import { createHmac } from 'crypto';
import mongoose from 'mongoose';
import { errorHandler } from '../src/middleware/errorHandler';
import { signToken } from '../src/middleware/auth';
import { EscrowOrder } from '../src/models/EscrowOrder';
import { Listing } from '../src/models/Listing';
import { User } from '../src/models/User';
import { config } from '../src/config';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fake = mongoose as any;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const express = require('express');

export const db = fake.__test;
export const oid = () => new db.ObjectId();

export interface Res {
  status: number;
  headers: Record<string, unknown>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
  handled: boolean;
}

/** Sends a request through a real Truth Market router (real middleware, real controllers) using the Express test double. */
export async function call(
  router: unknown,
  method: string,
  url: string,
  opts: { token?: string; body?: unknown; rawBody?: string; headers?: Record<string, string> } = {},
): Promise<Res> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const out = await express.__dispatch(router, { method, url, headers, body: opts.body, rawBody: opts.rawBody ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined) }, errorHandler);
  return out;
}

export interface Actors {
  admin: { id: string; token: string };
  seller: { id: string; token: string };
  buyer: { id: string; token: string };
  other: { id: string; token: string };
}

/** Wipes the in-memory database and creates an admin, a verified seller, a buyer and an unrelated user. */
export async function freshWorld(): Promise<Actors> {
  db.reset();
  const mk = async (name: string, role: 'user' | 'admin', phone: string, verified = false) => {
    const u = await User.create({ name, email: `${name.toLowerCase()}@t.local`, phone, passwordHash: 'x', role, isVerified: verified, verifiedSeller: verified, kyc: { status: verified ? 'verified' : 'none', idPhone: phone } });
    return { id: String(u._id), token: signToken(String(u._id)) };
  };
  return {
    admin: await mk('Admin', 'admin', '0987811955', true),
    seller: await mk('Seller', 'user', '0911000001', true),
    buyer: await mk('Buyer', 'user', '0911000002'),
    other: await mk('Other', 'user', '0911000003'),
  };
}

export async function makeListing(sellerId: string, priceETB: number, title = 'Sheger News') {
  const l = await Listing.create({ platform: 'telegram', title, handle: title.toLowerCase().replace(/\W+/g, '_'), category: 'news', subscribers: 1000, priceETB, seller: sellerId, status: 'active', verified: true });
  return String(l._id);
}

// ------------------------------------------------------------------ a scripted payment provider (global fetch)
export interface ProviderPayment {
  status: 'success' | 'failed' | 'pending';
  amount?: number;
  currency?: string;
}
export const provider = {
  payments: new Map<string, ProviderPayment>(),
  initialized: [] as { txRef: string; amount: number; currency: string }[],
  unreachable: false,
  reset() {
    this.payments.clear();
    this.initialized.length = 0;
    this.unreachable = false;
  },
  /** The buyer paid on the provider's hosted page. By default the amount is what the order asked for. */
  pay(txRef: string, p: Partial<ProviderPayment> = {}) {
    const asked = this.initialized.find((i) => i.txRef === txRef);
    this.payments.set(txRef, { status: 'success', amount: asked?.amount, currency: 'ETB', ...p });
  },
};

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown, init?: { method?: string; body?: string }) => {
  const url = String(input);
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  if (!url.startsWith(config.chapa.apiBase)) return realFetch(input as never, init as never);
  if (provider.unreachable) throw new Error('network down');
  const path = url.slice(config.chapa.apiBase.length);
  if (path === '/transaction/initialize') {
    const b = JSON.parse(init!.body!);
    provider.initialized.push({ txRef: b.tx_ref, amount: Number(b.amount), currency: b.currency });
    return json(200, { status: 'success', data: { checkout_url: `https://checkout.chapa.co/checkout/payment/${b.tx_ref}` } });
  }
  const m = /^\/transaction\/verify\/(.+)$/.exec(path);
  if (m) {
    const txRef = decodeURIComponent(m[1]);
    const p = provider.payments.get(txRef);
    if (!p) return json(404, { status: 'failed', message: 'Transaction not found' });
    return json(200, { status: 'success', data: { status: p.status, amount: p.amount, currency: p.currency ?? 'ETB', tx_ref: txRef, reference: `CHP-${txRef.slice(-6)}`, method: 'telebirr' } });
  }
  return json(404, {});
}) as typeof fetch;

/** A correctly signed webhook body, the way Chapa sends it. */
export function signedWebhook(txRef: string, event = 'charge.success') {
  const rawBody = JSON.stringify({ event, status: 'success', tx_ref: txRef });
  const signature = createHmac('sha256', config.chapa.webhookSecret).update(rawBody).digest('hex');
  return { rawBody, headers: { 'x-chapa-signature': signature } };
}

export async function orderByTxRef(txRef: string) {
  return EscrowOrder.findOne({ txRef }).lean();
}
