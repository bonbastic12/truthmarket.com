import { InferSchemaType, Schema, Types, model } from 'mongoose';

export const PLATFORMS = ['telegram', 'tiktok', 'youtube', 'instagram', 'facebook', 'website'] as const;
export const CATEGORIES = [
  'news', 'entertainment', 'comedy', 'music', 'sports', 'education', 'technology',
  'business', 'lifestyle', 'fashion', 'food', 'travel', 'gaming', 'religion', 'other',
] as const;
export const STATUSES = ['pending', 'active', 'escrow', 'sold', 'rejected'] as const;
export const SOCIAL_TRANSFER_METHODS = ['ethio_sim', 'admin_rights', 'primary_email', 'bot_transfer'] as const;
export const WEBSITE_TRANSFER_METHODS = ['domain_transfer', 'hosting_account', 'source_code', 'database_export'] as const;
export const TRANSFER_METHODS = [...SOCIAL_TRANSFER_METHODS, ...WEBSITE_TRANSFER_METHODS] as const;
export const SITE_TYPES = ['content_site', 'ecommerce', 'web_app', 'saas', 'directory', 'portfolio', 'other'] as const;
export const REVENUE_CURRENCIES = ['ETB', 'USD'] as const;

export type Platform = (typeof PLATFORMS)[number];
export type TransferMethod = (typeof TRANSFER_METHODS)[number];
export type ListingStatus = (typeof STATUSES)[number];

/** Extra details that only websites and web apps have. Social listings leave this out. */
const websiteSchema = new Schema(
  {
    /** Normalised to https://domain (no path). */
    url: { type: String, required: true, trim: true, lowercase: true, maxlength: 200 },
    siteType: { type: String, enum: SITE_TYPES, required: true },
    techStack: {
      type: [{ type: String, trim: true, maxlength: 30 }],
      validate: { validator: (v: string[]) => v.length > 0 && v.length <= 12, message: 'Add 1 to 12 technologies' },
    },
    monthlyVisits: { type: Number, required: true, min: 0, validate: Number.isInteger },
    monthlyPageviews: { type: Number, default: 0, min: 0, validate: Number.isInteger },
    /** What the seller typed, in the currency they chose. */
    monthlyRevenue: { type: Number, default: 0, min: 0 },
    revenueCurrency: { type: String, enum: REVENUE_CURRENCIES, default: 'ETB' },
    /** The same figure converted to ETB when the listing was created (USD_TO_ETB), used for sorting and pricing. */
    monthlyRevenueETB: { type: Number, default: 0, min: 0 },
    domainAgeMonths: { type: Number, default: 0, min: 0, max: 420 },
    domainRegistrar: { type: String, trim: true, maxlength: 60, default: '' },
    hostingProvider: { type: String, trim: true, maxlength: 60, default: '' },
    /** Free text: how the hosting, DNS and server access will be handed over. */
    hostingNotes: { type: String, trim: true, maxlength: 500, default: '' },
  },
  { _id: false },
);

const listingSchema = new Schema(
  {
    seller: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    platform: { type: String, enum: PLATFORMS, required: true },
    title: { type: String, required: true, trim: true, minlength: 3, maxlength: 120 },
    // Normalised: lower case, no leading "@".
    handle: { type: String, required: true, trim: true, lowercase: true, maxlength: 64 },
    category: { type: String, enum: CATEGORIES, required: true },
    description: { type: String, trim: true, maxlength: 2000, default: '' },
    // Social audience metrics. Websites leave these at 0 and use `website` instead.
    subscribers: { type: Number, default: 0, min: 0, validate: Number.isInteger },
    avgViews: { type: Number, default: 0, min: 0, validate: Number.isInteger },
    engagementRate: { type: Number, default: 0, min: 0, max: 100 },
    ageMonths: { type: Number, default: 0, min: 0, max: 240 },
    monetized: { type: Boolean, default: false },
    verified: { type: Boolean, default: false },
    priceETB: { type: Number, required: true, min: 100, max: 100_000_000, validate: Number.isInteger },
    website: { type: websiteSchema },
    transferMethods: {
      type: [{ type: String, enum: TRANSFER_METHODS }],
      validate: { validator: (v: string[]) => v.length > 0, message: 'Choose at least one transfer method' },
    },
    status: { type: String, enum: STATUSES, default: 'pending' },
    rejectionReason: { type: String, trim: true, maxlength: 300 },
    approvedAt: Date,
    soldAt: Date,
  },
  { timestamps: true },
);

// Full text search (handle weighs most, then title, then description).
listingSchema.index(
  { handle: 'text', title: 'text', description: 'text', 'website.techStack': 'text' },
  { weights: { handle: 10, title: 5, 'website.techStack': 3, description: 1 }, name: 'listing_text' },
);
// Marketplace filters: platform + price range, category, newest, biggest.
listingSchema.index({ status: 1, platform: 1, priceETB: 1 });
listingSchema.index({ status: 1, category: 1, createdAt: -1 });
listingSchema.index({ status: 1, createdAt: -1 });
listingSchema.index({ status: 1, subscribers: -1 });
listingSchema.index({ status: 1, engagementRate: -1 });
// Website filters and sorting.
listingSchema.index({ status: 1, platform: 1, 'website.monthlyVisits': -1 });
listingSchema.index({ status: 1, platform: 1, 'website.monthlyRevenueETB': -1 });
listingSchema.index({ status: 1, 'website.siteType': 1 });
// Seller dashboards and duplicate checks.
listingSchema.index({ seller: 1, status: 1 });
listingSchema.index({ platform: 1, handle: 1 });

export type ListingAttrs = InferSchemaType<typeof listingSchema> & { _id: Types.ObjectId };
export const Listing = model('Listing', listingSchema);
