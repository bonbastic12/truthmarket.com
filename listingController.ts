import { Request, Response } from 'express';
import { FilterQuery, isValidObjectId } from 'mongoose';
import { z } from 'zod';
import { EscrowOrder, OPEN_ORDER_STATUSES } from '../models/EscrowOrder';
import { config } from '../config';
import {
  CATEGORIES, Listing, ListingAttrs, PLATFORMS, REVENUE_CURRENCIES, SITE_TYPES, SOCIAL_TRANSFER_METHODS,
  STATUSES, TRANSFER_METHODS, WEBSITE_TRANSFER_METHODS,
} from '../models/Listing';
import { ApiError, asyncHandler } from '../utils/http';

const listQuery = z.object({
  platform: z.enum(PLATFORMS).optional(),
  category: z.enum(CATEGORIES).optional(),
  minPrice: z.coerce.number().min(0).optional(),
  maxPrice: z.coerce.number().min(0).optional(),
  minSubscribers: z.coerce.number().min(0).optional(),
  // Website filters
  siteType: z.enum(SITE_TYPES).optional(),
  tech: z.string().trim().min(1).max(30).optional(),
  minTraffic: z.coerce.number().min(0).optional(),
  verified: z.enum(['true', 'false']).optional(),
  search: z.string().trim().max(100).optional(),
  status: z.enum(STATUSES).optional(),
  mine: z.enum(['true', 'false']).optional(),
  sort: z.enum(['newest', 'priceAsc', 'priceDesc', 'subscribers', 'engagement', 'traffic', 'revenue']).default('newest'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(12),
});

/** "https://www.Example.com/shop?x=1" or "example.com" -> { url: "https://example.com", domain: "example.com" } */
function parseSiteUrl(input: string): { url: string; domain: string } | null {
  try {
    const u = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    const domain = u.hostname.toLowerCase().replace(/^www\./, '');
    // A real domain name only: no localhost, no IP addresses.
    if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/.test(domain)) return null;
    return { url: `https://${domain}`, domain };
  } catch {
    return null;
  }
}

const websiteSchema = z.object({
  url: z.string().trim().min(3).max(200),
  siteType: z.enum(SITE_TYPES),
  techStack: z.array(z.string().trim().min(1).max(30)).min(1, 'Add at least one technology').max(12),
  monthlyVisits: z.number().int().min(0).max(2_000_000_000),
  monthlyPageviews: z.number().int().min(0).max(20_000_000_000).default(0),
  monthlyRevenue: z.number().min(0).max(1_000_000_000).default(0),
  revenueCurrency: z.enum(REVENUE_CURRENCIES).default('ETB'),
  domainAgeMonths: z.number().int().min(0).max(420).default(0),
  domainRegistrar: z.string().trim().max(60).default(''),
  hostingProvider: z.string().trim().max(60).default(''),
  hostingNotes: z.string().trim().max(500).default(''),
});

const createSchema = z
  .object({
    platform: z.enum(PLATFORMS),
    title: z.string().trim().min(3).max(120),
    // Optional for websites: it is taken from the site address.
    handle: z.string().trim().max(64).optional(),
    category: z.enum(CATEGORIES),
    description: z.string().trim().max(2000).default(''),
    // Social metrics (required for social platforms, ignored for websites)
    subscribers: z.number().int().min(0).max(2_000_000_000).optional(),
    avgViews: z.number().int().min(0).max(2_000_000_000).optional(),
    engagementRate: z.number().min(0).max(100).optional(),
    ageMonths: z.number().int().min(0).max(240).default(0),
    monetized: z.boolean().default(false),
    website: websiteSchema.optional(),
    priceETB: z.number().int().min(100).max(100_000_000),
    transferMethods: z.array(z.enum(TRANSFER_METHODS)).min(1).max(TRANSFER_METHODS.length),
  })
  .superRefine((b, ctx) => {
    const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
    const allowed: readonly string[] = b.platform === 'website' ? WEBSITE_TRANSFER_METHODS : SOCIAL_TRANSFER_METHODS;
    if (b.transferMethods.some((m) => !allowed.includes(m))) {
      issue(['transferMethods'], b.platform === 'website' ? 'Pick website handover methods only' : 'Pick account transfer methods only');
    }
    if (b.platform === 'website') {
      if (!b.website) return issue(['website'], 'Website details are required');
      if (!parseSiteUrl(b.website.url)) issue(['website', 'url'], 'Enter a valid domain such as example.com');
    } else {
      if (!b.handle || b.handle.length < 2) issue(['handle'], 'Enter the account username');
      if (b.subscribers === undefined) issue(['subscribers'], 'Audience size is required');
      if (b.avgViews === undefined) issue(['avgViews'], 'Average views are required');
      if (b.engagementRate === undefined) issue(['engagementRate'], 'Engagement rate is required');
    }
  });

/** Turns a validated request into the document to store (website vs social fields, normalised handle). */
function buildListingDoc(body: z.infer<typeof createSchema>) {
  if (body.platform === 'website') {
    const site = parseSiteUrl(body.website!.url)!;
    const w = body.website!;
    const revenueETB = w.revenueCurrency === 'USD' ? w.monthlyRevenue * config.usdToEtb : w.monthlyRevenue;
    const seen = new Set<string>();
    const techStack = w.techStack.filter((t) => !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()));
    return {
      ...body,
      handle: site.domain,
      subscribers: 0,
      avgViews: 0,
      engagementRate: 0,
      monetized: revenueETB > 0,
      website: { ...w, url: site.url, techStack, monthlyRevenueETB: Math.round(revenueETB) },
    };
  }
  return { ...body, handle: body.handle!.replace(/^@/, '').toLowerCase(), website: undefined };
}

const statusSchema = z.object({
  status: z.enum(STATUSES),
  verified: z.boolean().optional(),
  rejectionReason: z.string().trim().max(300).optional(),
});

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const PUBLIC_SELLER_FIELDS = 'name verifiedSeller';

/**
 * GET /api/listings
 * Public visitors only ever see `active` listings. Admins may filter by any status,
 * and a logged in user may pass mine=true to see all of their own listings.
 */
export const getListings = asyncHandler(async (req: Request, res: Response) => {
  const q = listQuery.parse(req.query);
  const filter: FilterQuery<ListingAttrs> = {};

  if (q.mine === 'true') {
    if (!req.user) throw new ApiError(401, 'Please log in to see your listings');
    filter.seller = req.user.id;
    if (q.status) filter.status = q.status;
  } else if (req.user?.role === 'admin') {
    if (q.status) filter.status = q.status;
  } else {
    filter.status = 'active';
  }

  if (q.platform) filter.platform = q.platform;
  if (q.category) filter.category = q.category;
  if (q.verified) filter.verified = q.verified === 'true';
  if (q.minSubscribers !== undefined) filter.subscribers = { $gte: q.minSubscribers };
  if (q.siteType) filter['website.siteType'] = q.siteType;
  if (q.tech) filter['website.techStack'] = new RegExp(`^${escapeRegex(q.tech)}$`, 'i');
  if (q.minTraffic !== undefined) filter['website.monthlyVisits'] = { $gte: q.minTraffic };
  if (q.minPrice !== undefined || q.maxPrice !== undefined) {
    filter.priceETB = {
      ...(q.minPrice !== undefined ? { $gte: q.minPrice } : {}),
      ...(q.maxPrice !== undefined ? { $lte: q.maxPrice } : {}),
    };
  }
  if (q.search) {
    // Weighted full text search. If it finds nothing, a prefix match on handle/title is tried below
    // (so partial typing like "tech" still finds "techethdaily").
    filter.$text = { $search: q.search };
  }

  const sortMap = {
    newest: { createdAt: -1 },
    priceAsc: { priceETB: 1 },
    priceDesc: { priceETB: -1 },
    subscribers: { subscribers: -1 },
    engagement: { engagementRate: -1 },
    traffic: { 'website.monthlyVisits': -1 },
    revenue: { 'website.monthlyRevenueETB': -1 },
  } as const;
  const sort: Record<string, 1 | -1 | { $meta: 'textScore' }> = { ...sortMap[q.sort] };
  if (q.search && q.sort === 'newest') {
    delete sort.createdAt;
    sort.score = { $meta: 'textScore' };
    sort.createdAt = -1;
  }

  const run = async (f: FilterQuery<ListingAttrs>) => {
    const projection = f.$text ? { score: { $meta: 'textScore' } } : {};
    const [items, total] = await Promise.all([
      Listing.find(f, projection)
        .sort(sort)
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .populate('seller', PUBLIC_SELLER_FIELDS)
        .lean(),
      Listing.countDocuments(f),
    ]);
    return { items, total };
  };

  let result = await run(filter);

  // Fallback for partial words: if the text search found nothing, match the handle or title prefix.
  if (q.search && result.total === 0) {
    const { $text: _ignored, ...rest } = filter;
    void _ignored;
    const rx = new RegExp('^' + escapeRegex(q.search.replace(/^@/, '')), 'i');
    sort.createdAt = -1;
    delete sort.score;
    result = await run({ ...rest, $or: [{ handle: rx }, { title: rx }] });
  }

  res.json({
    items: result.items,
    total: result.total,
    page: q.page,
    pages: Math.max(1, Math.ceil(result.total / q.limit)),
  });
});

/** GET /api/listings/stats (admin) - counts per status for the moderation dashboard. */
export const getStats = asyncHandler(async (_req: Request, res: Response) => {
  const rows = await Listing.aggregate<{ _id: string; count: number }>([{ $group: { _id: '$status', count: { $sum: 1 } } }]);
  const stats: Record<string, number> = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const r of rows) stats[r._id] = r.count;
  res.json({ stats });
});

export const getListing = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!isValidObjectId(id)) throw new ApiError(400, 'Invalid listing id');
  const listing = await Listing.findById(id).populate('seller', PUBLIC_SELLER_FIELDS).lean();
  if (!listing) throw new ApiError(404, 'Listing not found');
  const sellerId = String((listing.seller as unknown as { _id: unknown })._id);
  const canSee = listing.status === 'active' || req.user?.role === 'admin' || req.user?.id === sellerId;
  if (!canSee) throw new ApiError(404, 'Listing not found');
  res.json({ listing });
});

/** POST /api/listings - always created as `pending`; an admin must approve it. */
export const createListing = asyncHandler(async (req: Request, res: Response) => {
  const body = buildListingDoc(createSchema.parse(req.body));
  const duplicate = await Listing.exists({
    platform: body.platform,
    handle: body.handle,
    status: { $in: ['pending', 'active', 'escrow'] },
  });
  if (duplicate) throw new ApiError(409, body.platform === 'website' ? 'This website is already listed' : 'This account is already listed');
  const listing = await Listing.create({
    ...body,
    seller: req.user!.id,
    status: 'pending',
    verified: false,
  });
  res.status(201).json({ listing });
});

/**
 * PATCH /api/listings/:id/status (admin)
 * Moves a listing between pending, active, escrow, sold and rejected.
 * A listing with an open escrow order is locked: its order decides the status.
 */
export const updateListingStatus = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!isValidObjectId(id)) throw new ApiError(400, 'Invalid listing id');
  const body = statusSchema.parse(req.body);

  const current = await Listing.findById(id);
  if (!current) throw new ApiError(404, 'Listing not found');

  if (body.status !== current.status) {
    const open = await EscrowOrder.exists({ listing: id, status: { $in: OPEN_ORDER_STATUSES } });
    if (open) throw new ApiError(409, 'This listing has an open escrow order. Resolve the order first.');
  }

  current.status = body.status;
  if (body.verified !== undefined) current.verified = body.verified;
  if (body.status === 'active' && !current.approvedAt) current.approvedAt = new Date();
  if (body.status === 'sold') current.soldAt = new Date();
  if (body.status === 'rejected') current.rejectionReason = body.rejectionReason ?? 'Rejected by moderator';
  else current.rejectionReason = undefined;
  await current.save();

  res.json({ listing: current });
});

/** DELETE /api/listings/:id (admin) - inventory removal, blocked while an escrow order is open. */
export const deleteListing = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!isValidObjectId(id)) throw new ApiError(400, 'Invalid listing id');
  const open = await EscrowOrder.exists({ listing: id, status: { $in: OPEN_ORDER_STATUSES } });
  if (open) throw new ApiError(409, 'This listing has an open escrow order');
  const removed = await Listing.findByIdAndDelete(id);
  if (!removed) throw new ApiError(404, 'Listing not found');
  res.status(204).end();
});
