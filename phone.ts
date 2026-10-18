/** Accepts 09xxxxxxxx, 07xxxxxxxx, +2519xxxxxxxx, 2519xxxxxxxx and returns 09xxxxxxxx (or the cleaned input if it is not a phone). */
export function normalizePhone(v: string): string {
  let s = v.replace(/[\s\-()]/g, '');
  if (s.startsWith('+251')) s = '0' + s.slice(4);
  else if (s.startsWith('251') && s.length === 12) s = '0' + s.slice(3);
  else if (/^[79]\d{8}$/.test(s)) s = '0' + s;
  return s;
}

export const isEthiopianMobile = (p: string) => /^0[79]\d{8}$/.test(p);

/** 0911234567 -> 09*****567, for screens and logs. */
export const maskPhone = (p: string) => (p.length >= 5 ? `${p.slice(0, 2)}${'*'.repeat(p.length - 5)}${p.slice(-3)}` : '***');

/** International format used by SMS gateways: 0911234567 -> +251911234567. */
export const toInternational = (p: string) => `+251${p.slice(1)}`;
