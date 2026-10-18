import type { Platform } from '../types';

export interface PlatformTheme {
  /** Vertical gradient of the left strip (top to bottom). */
  strip: string;
  /** Gradient of the Buy button and the avatar tile. */
  action: string;
  /** Strip label. */
  name: string;
  /** Where the account lives, for the "Open on ..." link. Returns null when the handle cannot form a safe link. */
  link(handle: string, siteUrl?: string): string | null;
}

const enc = (h: string) => encodeURIComponent(h.replace(/^@/, '').trim());

/** One place for each platform's colours and public link pattern. All colours are plain CSS so they work in both themes. */
export const PLATFORM_THEME: Record<Platform, PlatformTheme> = {
  telegram: { name: 'Telegram', strip: 'linear-gradient(180deg,#2AABEE 0%,#1B7FBF 100%)', action: 'linear-gradient(135deg,#2AABEE,#1B7FBF)', link: (h) => `https://t.me/${enc(h)}` },
  tiktok: { name: 'TikTok', strip: 'linear-gradient(180deg,#0B0B0F 0%,#3A1030 55%,#FE2C55 100%)', action: 'linear-gradient(135deg,#111118,#FE2C55)', link: (h) => `https://www.tiktok.com/@${enc(h)}` },
  youtube: { name: 'YouTube', strip: 'linear-gradient(180deg,#FF2A2A 0%,#B80000 100%)', action: 'linear-gradient(135deg,#FF2A2A,#C40000)', link: (h) => `https://www.youtube.com/@${enc(h)}` },
  instagram: { name: 'Instagram', strip: 'linear-gradient(180deg,#F58529 0%,#DD2A7B 50%,#8134AF 100%)', action: 'linear-gradient(135deg,#F58529,#DD2A7B 55%,#8134AF)', link: (h) => `https://www.instagram.com/${enc(h)}` },
  facebook: { name: 'Facebook', strip: 'linear-gradient(180deg,#1877F2 0%,#0E4DB3 100%)', action: 'linear-gradient(135deg,#1877F2,#0E56C7)', link: (h) => `https://www.facebook.com/${enc(h)}` },
  website: {
    name: 'Web & Apps',
    strip: 'linear-gradient(180deg,#2F6BFF 0%,#4338CA 100%)',
    action: 'linear-gradient(135deg,#2F6BFF,#4338CA)',
    // Only http(s) addresses become links; anything else (javascript:, data:) is dropped.
    link: (_h, siteUrl) => (siteUrl && /^https?:\/\//i.test(siteUrl) ? siteUrl : null),
  },
};

/** Listings added in the last 7 days get the NEW tag. */
export const isNewListing = (createdAt: string, now = Date.now()) => {
  const t = Date.parse(createdAt);
  return Number.isFinite(t) && now - t < 7 * 24 * 3600 * 1000;
};
