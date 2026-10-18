import { useState } from 'react';
import type { Platform } from '../types';

const BRANDED: Platform[] = ['telegram', 'tiktok', 'youtube', 'instagram', 'facebook'];

/**
 * Shows the official brand logo when you have added it as /platforms/<platform>.svg (see public/platforms/README.md),
 * and the plain icon below, in the platform's colour, until then. `website` always uses the globe icon.
 */
export default function PlatformIcon({ platform, className = 'h-4 w-4', mono = false }: { platform: Platform; className?: string; mono?: boolean }) {
  const [missing, setMissing] = useState(false);
  // mono: a plain white line icon for use on a coloured background (the card's left strip), where brand colours would vanish.
  if (mono) return <FallbackIcon platform={platform} className={`${className} text-white`} />;
  if (BRANDED.includes(platform) && !missing) {
    return <img src={`/platforms/${platform}.svg`} alt="" aria-hidden="true" className={`${className} object-contain`} onError={() => setMissing(true)} />;
  }
  return <FallbackIcon platform={platform} className={`${className} ${BRAND_COLOR[platform]}`} />;
}

/** Each platform's own colour on its icon. TikTok follows the text colour so it stays visible in both themes. */
const BRAND_COLOR: Record<Platform, string> = {
  youtube: 'text-[#FF0000]',
  instagram: 'text-[#E1306C]',
  tiktok: 'text-slate-900',
  telegram: 'text-[#229ED9]',
  facebook: 'text-[#1877F2]',
  website: 'text-blue-600',
};

/** Single-colour icons that follow the surrounding text colour in both themes. */
function FallbackIcon({ platform, className }: { platform: Platform; className: string }) {
  const common = { viewBox: '0 0 24 24', className, 'aria-hidden': true, fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (platform) {
    case 'telegram':
      return (
        <svg {...common}>
          <path d="M21 4L3 11l6.500 2.500L12 20l2.800-4.200L19.500 19z" />
          <path d="M9.500 13.500L21 4" />
        </svg>
      );
    case 'tiktok':
      return (
        <svg {...common}>
          <path d="M14 4v10.500a3.500 3.500 0 1 1-3.500-3.500" />
          <path d="M14 4c.4 2.300 2 3.800 4.500 4" />
        </svg>
      );
    case 'youtube':
      return (
        <svg {...common}>
          <rect x="2.500" y="5.500" width="19" height="13" rx="4" />
          <path d="M10 9.500v5l4.500-2.500z" fill="currentColor" />
        </svg>
      );
    case 'instagram':
      return (
        <svg {...common}>
          <rect x="3.500" y="3.500" width="17" height="17" rx="5" />
          <circle cx="12" cy="12" r="4" />
          <circle cx="17" cy="7" r=".6" fill="currentColor" />
        </svg>
      );
    case 'facebook':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M13.500 20.500V13h2.500M10.500 13h5.500M13.500 13v-2.500A2.500 2.500 0 0 1 16 8h1" />
        </svg>
      );
    case 'website':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18" />
          <path d="M12 3c2.600 2.400 3.900 5.400 3.900 9S14.600 18.600 12 21c-2.600-2.400-3.900-5.400-3.900-9S9.400 5.400 12 3z" />
          <path d="M9.200 8.800L6.800 12l2.400 3.200M14.800 8.800l2.400 3.200-2.400 3.200" strokeWidth={2.200} className="[paint-order:stroke]" />
        </svg>
      );
  }
}
