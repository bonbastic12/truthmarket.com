import type { OrderStatus } from '../types';

export const ORDER_STATUS_META: Record<OrderStatus, { label: string; tone: string; help: string }> = {
  PENDING_PAYMENT: { label: 'Waiting for payment', tone: 'bg-amber-100 text-amber-900', help: 'Finish the payment on Chapa. The account is reserved for you until the timer ends.' },
  FUNDS_HELD_IN_ESCROW: { label: 'Paid - funds in escrow', tone: 'bg-emerald-100 text-emerald-800', help: 'Your payment is confirmed and locked. The seller now hands over the account.' },
  TRANSFERRED: { label: 'Inspection period', tone: 'bg-blue-100 text-blue-800', help: 'Check the account. Release the funds, or report a problem before the timer ends.' },
  COMPLETED: { label: 'Completed', tone: 'bg-slate-900 text-white', help: 'Funds were released to the seller.' },
  DISPUTED: { label: 'Dispute open', tone: 'bg-red-100 text-red-800', help: 'The funds stay locked while Truth Market reviews the problem.' },
  CANCELLED: { label: 'Cancelled', tone: 'bg-slate-200 text-slate-700', help: 'This order was not paid and the account is available again.' },
  REFUND_REQUIRED: { label: 'Refund in progress', tone: 'bg-red-100 text-red-800', help: 'The payment could not be matched to an available account. Truth Market refunds you.' },
  REFUNDED: { label: 'Refunded', tone: 'bg-slate-200 text-slate-700', help: 'The payment was returned to the buyer.' },
};

export const isClosed = (s: OrderStatus) => ['COMPLETED', 'CANCELLED', 'REFUNDED'].includes(s);

/** "47h 12m" style countdown, or null once the time has passed. */
export function timeLeft(iso: string | undefined, now = Date.now()): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return null;
  const m = Math.floor(ms / 60000);
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
}
