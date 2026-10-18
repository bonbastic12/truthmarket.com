export const PLATFORMS = ['telegram', 'tiktok', 'youtube', 'instagram', 'facebook', 'website'] as const;
export type Platform = (typeof PLATFORMS)[number];

export const CATEGORIES = [
  'news', 'entertainment', 'comedy', 'music', 'sports', 'education', 'technology',
  'business', 'lifestyle', 'fashion', 'food', 'travel', 'gaming', 'religion', 'other',
] as const;
export type Category = (typeof CATEGORIES)[number];

export type ListingStatus = 'pending' | 'active' | 'escrow' | 'sold' | 'rejected';

export const SOCIAL_TRANSFER_METHODS = ['ethio_sim', 'admin_rights', 'primary_email', 'bot_transfer'] as const;
export const WEBSITE_TRANSFER_METHODS = ['domain_transfer', 'hosting_account', 'source_code', 'database_export'] as const;
export const TRANSFER_METHODS = [...SOCIAL_TRANSFER_METHODS, ...WEBSITE_TRANSFER_METHODS] as const;
export type TransferMethod = (typeof TRANSFER_METHODS)[number];

export const SITE_TYPES = ['content_site', 'ecommerce', 'web_app', 'saas', 'directory', 'portfolio', 'other'] as const;
export type SiteType = (typeof SITE_TYPES)[number];
export const SITE_TYPE_LABEL: Record<SiteType, string> = {
  content_site: 'Blog / content site',
  ecommerce: 'Online store',
  web_app: 'Web application',
  saas: 'SaaS product',
  directory: 'Directory / marketplace',
  portfolio: 'Portfolio / business site',
  other: 'Other',
};
export type RevenueCurrency = 'ETB' | 'USD';

/** Popular choices shown as one-tap chips. Sellers can still type any technology. */
export const TECH_SUGGESTIONS = [
  'React', 'Next.js', 'Node.js', 'Express', 'MongoDB', 'WordPress', 'Laravel', 'PHP',
  'Django', 'Python', 'Vue', 'Angular', 'Shopify', 'Flutter', 'Firebase', 'MySQL', 'PostgreSQL', 'Tailwind CSS',
] as const;

/** Social platforms keep the "@name" style, websites show the domain. */
export const displayHandle = (platform: Platform, handle: string) => (platform === 'website' ? handle : `@${handle}`);
export const isWebsiteListing = (l: { platform: Platform }) => l.platform === 'website';

export const PLATFORM_META: Record<
  Platform,
  { label: string; audienceLabel: string; viewsLabel: string; badge: string }
> = {
  telegram: { label: 'Telegram', audienceLabel: 'Subscribers', viewsLabel: 'Avg post views', badge: 'bg-sky-100 text-sky-800' },
  tiktok: { label: 'TikTok', audienceLabel: 'Followers', viewsLabel: 'Avg video views', badge: 'bg-slate-900 text-white' },
  youtube: { label: 'YouTube', audienceLabel: 'Subscribers', viewsLabel: 'Avg video views', badge: 'bg-red-100 text-red-800' },
  instagram: { label: 'Instagram', audienceLabel: 'Followers', viewsLabel: 'Avg post reach', badge: 'bg-fuchsia-100 text-fuchsia-800' },
  facebook: { label: 'Facebook', audienceLabel: 'Followers', viewsLabel: 'Avg post reach', badge: 'bg-blue-100 text-blue-800' },
  website: { label: 'Websites & Apps', audienceLabel: 'Monthly visitors', viewsLabel: 'Monthly pageviews', badge: 'bg-indigo-100 text-indigo-800' },
};

export const TRANSFER_META: Record<TransferMethod, { label: string; hint: string }> = {
  ethio_sim: { label: 'Ethio Telecom SIM ownership', hint: 'The account is tied to a registered Ethio Telecom SIM. The SIM is handed to the buyer or re-registered in their name.' },
  admin_rights: { label: 'Admin rights', hint: 'The buyer is made owner or admin of the channel, group or page and the seller steps down.' },
  primary_email: { label: 'Primary email', hint: 'The login email is changed to or handed over with the account, with recovery details updated.' },
  bot_transfer: { label: 'Bot transfer', hint: 'Bots connected to the channel are handed over with their tokens, and old tokens are revoked.' },
  domain_transfer: { label: 'Domain transfer', hint: 'The domain is pushed to the buyer at the registrar (auth/EPP code or registrar account move) and the WHOIS owner is updated.' },
  hosting_account: { label: 'Hosting & server access', hint: 'Hosting, cloud or server account ownership is moved to the buyer, with DNS and SSL kept working.' },
  source_code: { label: 'Source code & repository', hint: 'The full source code is handed over (GitHub/GitLab repository transfer) together with build and deploy steps.' },
  database_export: { label: 'Database & content export', hint: 'A complete database backup, uploaded media and third-party keys (payments, email, analytics) are handed over.' },
};

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: 'user' | 'admin';
  verifiedSeller: boolean;
  /** True only while the National ID + phone check is fully passed. Selling needs it. */
  isVerified: boolean;
  kycStatus: KycStatus;
}

export type KycStatus = 'none' | 'otp_pending' | 'pending_review' | 'verified' | 'rejected' | 'flagged';

export interface KycState {
  status: KycStatus;
  isVerified: boolean;
  idLast4: string | null;
  fullNameOnId: string | null;
  /** Masked, for example 09*****567 */
  phone: string | null;
  submittedAt: string | null;
  rejectionReason: string | null;
  otpExpiresAt: string | null;
  resendAt: string | null;
}

export interface WebsiteDetails {
  url: string;
  siteType: SiteType;
  techStack: string[];
  monthlyVisits: number;
  monthlyPageviews: number;
  /** As entered by the seller, in `revenueCurrency`. */
  monthlyRevenue: number;
  revenueCurrency: RevenueCurrency;
  monthlyRevenueETB: number;
  domainAgeMonths: number;
  domainRegistrar: string;
  hostingProvider: string;
  hostingNotes: string;
}

export interface Listing {
  _id: string;
  seller: { _id: string; name: string; verifiedSeller?: boolean } | string;
  platform: Platform;
  title: string;
  handle: string;
  /** Optional profile picture. Cards fall back to the handle's initials when it is missing or fails to load. */
  avatarUrl?: string;
  category: Category;
  description: string;
  subscribers: number;
  avgViews: number;
  engagementRate: number;
  ageMonths: number;
  monetized: boolean;
  verified: boolean;
  priceETB: number;
  /** Only present when platform is 'website'. Social metrics above are 0 for websites. */
  website?: WebsiteDetails;
  transferMethods: TransferMethod[];
  status: ListingStatus;
  rejectionReason?: string;
  createdAt: string;
}

export interface ListingPage {
  items: Listing[];
  total: number;
  page: number;
  pages: number;
}

export type OrderStatus =
  | 'PENDING_PAYMENT'
  | 'FUNDS_HELD_IN_ESCROW'
  | 'TRANSFERRED'
  | 'COMPLETED'
  | 'DISPUTED'
  | 'CANCELLED'
  | 'REFUND_REQUIRED'
  | 'REFUNDED';

export interface EscrowOrder {
  _id: string;
  txRef: string;
  listing: { _id: string; title: string; handle: string; platform: Platform; status: ListingStatus } | null;
  buyer: { _id: string; name: string; phone?: string };
  seller: { _id: string; name: string };
  priceETB: number;
  /** Service fee the buyer paid on top of priceETB, and the full amount charged. Missing on orders from before the fee existed. */
  buyerFeeRate?: number;
  buyerFeeETB?: number;
  /** true when the flat small-sale fee (under 1,000 ETB) was charged instead of the percentage */
  buyerFeeFlat?: boolean;
  totalETB?: number;
  commissionRate: number;
  commissionETB: number;
  sellerEscrowETB: number;
  status: OrderStatus;
  checkoutUrl?: string;
  paymentMethod?: string;
  expiresAt: string;
  fundsHeldAt?: string;
  transferredAt?: string;
  inspectionEndsAt?: string;
  completedAt?: string;
  autoReleased?: boolean;
  createdAt: string;
}

export interface Wallet {
  lockedETB: number;
  releasedETB: number;
  pendingETB: number;
  paidETB: number;
  availableETB: number;
  minWithdrawalETB: number;
}

export const PAYOUT_METHODS = [
  'telebirr', 'cbe_birr', 'cbe', 'awash', 'dashen', 'abyssinia', 'wegagen', 'hibret', 'nib', 'zemen', 'oromia', 'bunna', 'enat', 'berhan',
] as const;
export type PayoutMethod = (typeof PAYOUT_METHODS)[number];
export const WALLET_PAYOUT_METHODS: readonly PayoutMethod[] = ['telebirr', 'cbe_birr'];
export const PAYOUT_LABEL: Record<PayoutMethod, string> = {
  telebirr: 'Telebirr', cbe_birr: 'CBE Birr', cbe: 'Commercial Bank of Ethiopia', awash: 'Awash Bank', dashen: 'Dashen Bank',
  abyssinia: 'Bank of Abyssinia', wegagen: 'Wegagen Bank', hibret: 'Hibret Bank', nib: 'Nib Bank', zemen: 'Zemen Bank',
  oromia: 'Oromia Bank', bunna: 'Bunna Bank', enat: 'Enat Bank', berhan: 'Berhan Bank',
};

export interface WithdrawalRow {
  id: string;
  amountETB: number;
  method: PayoutMethod;
  accountName: string;
  accountLast4: string;
  status: 'requested' | 'paid' | 'rejected';
  rejectionReason: string | null;
  paymentReference: string | null;
  createdAt: string;
  decidedAt: string | null;
}

// ---- commission & revenue (admin) and seller earnings -------------------------------------------------------------

export interface MoneyGroup {
  total: number;
  count: number;
}

/** GET /api/admin/revenue/summary. Administrators only; the server answers 401/403 to everyone else. */
export interface RevenueSummary {
  generatedAt: string;
  grossVolumeETB: number;
  listingVolumeETB: number;
  sellerCommissionsETB: number;
  buyerFeesETB: number;
  combinedRevenueETB: number;
  completedSales: number;
  reconciled: boolean;
  heldRevenueETB: number;
  pendingPayments: MoneyGroup;
  verifiedInEscrow: MoneyGroup;
  completedVerifiedPayments: MoneyGroup;
  needsRefund: MoneyGroup;
  refunds: MoneyGroup;
  reversedCommissionsETB: number;
  reversedBuyerFeesETB: number;
  sellerPayables: {
    lockedInEscrowETB: number;
    releasedETB: number;
    withdrawalsRequested: MoneyGroup;
    paidOut: MoneyGroup;
    availableETB: number;
  };
  payoutRecords: { requested: number; completed: number; rejected: number };
}

export interface RevenueReportRow {
  period: string;
  sales: number;
  sellerCommissionsETB: number;
  buyerFeesETB: number;
  revenueETB: number;
  refundedETB: number;
}

export interface RevenueTransaction {
  id: string;
  txRef: string;
  date: string;
  completedAt: string | null;
  status: OrderStatus;
  listing: string;
  platform: string;
  buyer: string;
  seller: string;
  priceETB: number;
  buyerFeeRate: number;
  buyerFeeETB: number;
  buyerTotalETB: number;
  sellerCommissionRate: number;
  sellerCommissionETB: number;
  sellerNetETB: number;
  revenueETB: number;
  heldRevenueETB: number;
  refundedETB: number;
  paymentMethod: string;
  providerReference: string;
}

export interface SellerPayableRow {
  sellerId: string;
  name: string;
  phone: string;
  lockedETB: number;
  releasedETB: number;
  requestedETB: number;
  paidETB: number;
  availableETB: number;
}

export interface CommissionSettings {
  sellerCommissionRate: number;
  buyerFeeRate: number;
  history: {
    at: string;
    by: string | null;
    sellerCommissionRate: number;
    buyerFeeRate: number;
    previousSellerCommissionRate: number;
    previousBuyerFeeRate: number;
  }[];
}

/** GET /api/wallet/earnings: the caller's OWN sales only. It never carries a buyer fee, a buyer total or any platform figure. */
export interface SellerEarnings {
  totals: { listingPriceETB: number; commissionETB: number; netProceedsETB: number; pendingPayoutETB: number; completedPayoutsETB: number };
  sales: {
    id: string;
    date: string;
    listing: string;
    platform: string;
    status: OrderStatus;
    priceETB: number;
    commissionRate: number;
    commissionETB: number;
    netETB: number;
    payout: 'in_escrow' | 'released' | 'refunded';
  }[];
}
