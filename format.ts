const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const etb = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

export const formatCompact = (n: number) => compact.format(n);
export const formatETB = (n: number) => `${etb.format(Math.round(n))} ETB`;

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function formatAge(months: number): string {
  if (months < 1) return 'New';
  if (months < 12) return `${months} mo`;
  const y = Math.floor(months / 12);
  const m = months % 12;
  return m ? `${y} yr ${m} mo` : `${y} yr`;
}

const usd = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
export const formatUSD = (n: number) => `$${usd.format(Math.round(n))}`;

/** "12,000 ETB" or "$120" depending on the currency the seller entered. */
export const formatMoney = (n: number, currency: 'ETB' | 'USD') => (currency === 'USD' ? formatUSD(n) : formatETB(n));
