import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { config } from './config';
import { Listing } from './models/Listing';
import { User } from './models/User';

/** Creates an admin, a demo seller and a few active listings. Safe to run twice. */
async function seed() {
  await mongoose.connect(config.mongoUri);
  await Promise.all([User.createIndexes(), Listing.createIndexes()]); // additive only, never drops anything

  const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? 'admin@truthmarket.local').toLowerCase();
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe12345';
  // On a real deployment the seed only creates the admin, with a strong password you choose. It never creates
  // demo sellers or demo listings (they would be buyable with real money), and never prints the password.
  if (config.isProd && (!process.env.SEED_ADMIN_PASSWORD || adminPassword === 'ChangeMe12345' || adminPassword.length < 12)) {
    throw new Error('Production seed: set SEED_ADMIN_EMAIL and a SEED_ADMIN_PASSWORD of at least 12 characters (not the example value).');
  }

  await User.updateOne(
    { email: adminEmail },
    { $setOnInsert: { name: 'Truth Market Admin', email: adminEmail, phone: '0987811955', passwordHash: await bcrypt.hash(adminPassword, 12), role: 'admin', verifiedSeller: true, isVerified: true, kyc: { status: 'verified', idPhone: '0987811955', fullNameOnId: 'Demo (seed data, no real ID)' } } },
    { upsert: true },
  );
  if (config.isProd) {
    console.log(`Production seed finished: admin ${adminEmail} exists. No demo data was created.`);
    await mongoose.disconnect();
    return;
  }
  await User.updateOne(
    { email: 'seller@truthmarket.local' },
    { $setOnInsert: { name: 'Demo Seller', email: 'seller@truthmarket.local', phone: '0911000000', passwordHash: await bcrypt.hash('Seller12345', 12), verifiedSeller: true, isVerified: true, kyc: { status: 'verified', idPhone: '0911000000', fullNameOnId: 'Demo Seller (seed data, no real ID)' } } },
    { upsert: true },
  );
  const seller = await User.findOne({ email: 'seller@truthmarket.local' });
  if (!seller) throw new Error('Seed seller missing');

  const samples = [
    { platform: 'telegram', title: 'Sheger News Feed', handle: 'sheger_news_feed', category: 'news', subscribers: 12400, avgViews: 3100, engagementRate: 25, ageMonths: 30, priceETB: 9800, transferMethods: ['admin_rights', 'bot_transfer'] },
    { platform: 'tiktok', title: 'Comedy Corner ET', handle: 'comedy.corner.et', category: 'comedy', subscribers: 48200, avgViews: 6900, engagementRate: 9, ageMonths: 18, priceETB: 21500, transferMethods: ['ethio_sim', 'primary_email'] },
    { platform: 'youtube', title: 'Tech Ethiopia Daily', handle: 'techethdaily', category: 'technology', subscribers: 8700, avgViews: 1200, engagementRate: 5, ageMonths: 40, monetized: true, priceETB: 14500, transferMethods: ['primary_email'] },
    { platform: 'instagram', title: 'Addis Lifestyle', handle: 'addis.lifestyle', category: 'lifestyle', subscribers: 5400, avgViews: 800, engagementRate: 4, ageMonths: 24, priceETB: 3600, transferMethods: ['primary_email'] },
    { platform: 'facebook', title: 'Ethio Food Lovers', handle: 'ethio.food.lovers', category: 'food', subscribers: 26300, avgViews: 1900, engagementRate: 2, ageMonths: 60, priceETB: 7200, transferMethods: ['admin_rights'] },
  ] as const;

  for (const s of samples) {
    await Listing.updateOne(
      { platform: s.platform, handle: s.handle },
      { $setOnInsert: { ...s, transferMethods: [...s.transferMethods], seller: seller._id, status: 'active', verified: true, approvedAt: new Date(), description: `${s.title} - established ${s.platform} audience in Ethiopia.` } },
      { upsert: true },
    );
  }
  const sites = [
    { title: 'Addis Jobs Board', domain: 'addisjobs.example', category: 'business', siteType: 'directory', techStack: ['Next.js', 'Node.js', 'MongoDB'], monthlyVisits: 42000, monthlyPageviews: 118000, monthlyRevenue: 38000, revenueCurrency: 'ETB', domainAgeMonths: 36, hostingProvider: 'Vercel + MongoDB Atlas', priceETB: 780000, transferMethods: ['domain_transfer', 'hosting_account', 'source_code', 'database_export'] },
    { title: 'Habesha Recipes Blog', domain: 'habesharecipes.example', category: 'food', siteType: 'content_site', techStack: ['WordPress', 'PHP'], monthlyVisits: 18500, monthlyPageviews: 51000, monthlyRevenue: 120, revenueCurrency: 'USD', domainAgeMonths: 52, hostingProvider: 'Hostinger', priceETB: 190000, transferMethods: ['domain_transfer', 'hosting_account'] },
    { title: 'EthioShop Storefront', domain: 'ethioshop.example', category: 'business', siteType: 'ecommerce', techStack: ['React', 'Node.js', 'Express', 'MongoDB'], monthlyVisits: 9300, monthlyPageviews: 36000, monthlyRevenue: 65000, revenueCurrency: 'ETB', domainAgeMonths: 20, hostingProvider: 'DigitalOcean', priceETB: 950000, transferMethods: ['domain_transfer', 'hosting_account', 'source_code'] },
  ] as const;
  for (const w of sites) {
    const revenueETB = w.revenueCurrency === 'USD' ? w.monthlyRevenue * config.usdToEtb : w.monthlyRevenue;
    await Listing.updateOne(
      { platform: 'website', handle: w.domain },
      {
        $setOnInsert: {
          platform: 'website', title: w.title, handle: w.domain, category: w.category, priceETB: w.priceETB,
          transferMethods: [...w.transferMethods], seller: seller._id, status: 'active', verified: true, approvedAt: new Date(),
          monetized: revenueETB > 0, description: `${w.title} - sample website listing.`,
          website: {
            url: `https://${w.domain}`, siteType: w.siteType, techStack: [...w.techStack], monthlyVisits: w.monthlyVisits,
            monthlyPageviews: w.monthlyPageviews, monthlyRevenue: w.monthlyRevenue, revenueCurrency: w.revenueCurrency,
            monthlyRevenueETB: Math.round(revenueETB), domainAgeMonths: w.domainAgeMonths, hostingProvider: w.hostingProvider,
          },
        },
      },
      { upsert: true },
    );
  }
  console.log(`Seeded. Admin login: ${adminEmail} / ${adminPassword}   Demo seller: seller@truthmarket.local / Seller12345`);
  await mongoose.disconnect();
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
