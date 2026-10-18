type Ref = { _id?: unknown } | string | { toString(): string } | null | undefined;
const idOf = (r: Ref): string => String(r && typeof r === 'object' && '_id' in r ? (r as { _id?: unknown })._id : r);

/**
 * What each person may see of an order. Money fields are split by role on the server:
 *  - the buyer sees the price, the service fee and the total they paid, not the seller's commission or share;
 *  - the seller sees the price, the commission taken from them and their net proceeds, not the buyer's fee or total;
 *  - an admin sees everything.
 * Internal bookkeeping flags are admin-only.
 */
export function orderView<T extends Record<string, unknown>>(order: T, viewer: { id: string; role: string }): Record<string, unknown> {
  if (viewer.role === 'admin') return order;
  const out: Record<string, unknown> = { ...order };
  for (const k of ['ledgerPosted', 'ledgerVersion', 'paidETB', 'chapaReference']) delete out[k];
  const isSeller = idOf(order.seller as Ref) === viewer.id;
  if (isSeller) {
    for (const k of ['buyerFeeRate', 'buyerFeeETB', 'totalETB']) delete out[k];
    out.sellerNetETB = (order.sellerEscrowETB as number | undefined) ?? 0;
  } else {
    for (const k of ['commissionRate', 'commissionETB', 'sellerEscrowETB']) delete out[k];
  }
  return out;
}
