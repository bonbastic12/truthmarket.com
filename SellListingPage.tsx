import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../api';
import { useAuth } from '../auth/AuthContext';
import { formatETB } from '../lib/format';
import { pct, useAppConfig } from '../lib/config';
import { estimatePrice, estimateWebsitePrice } from '../lib/priceEstimator';
import PlatformIcon from './PlatformIcon';
import {
  CATEGORIES, PLATFORMS, PLATFORM_META, SITE_TYPES, SITE_TYPE_LABEL, SOCIAL_TRANSFER_METHODS, TECH_SUGGESTIONS,
  TRANSFER_META, WEBSITE_TRANSFER_METHODS,
  type Listing, type Platform, type RevenueCurrency, type SiteType, type TransferMethod,
} from '../types';

const field =
  'mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm font-normal outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20';

interface FormState {
  platform: Platform;
  title: string;
  handle: string;
  category: string;
  description: string;
  subscribers: string;
  avgViews: string;
  engagementRate: string;
  ageMonths: string;
  monetized: boolean;
  priceETB: string;
  transferMethods: TransferMethod[];
  // Website / web app fields
  url: string;
  siteType: SiteType;
  techStack: string[];
  monthlyVisits: string;
  monthlyPageviews: string;
  monthlyRevenue: string;
  revenueCurrency: RevenueCurrency;
  domainAgeMonths: string;
  domainRegistrar: string;
  hostingProvider: string;
  hostingNotes: string;
}

const EMPTY: FormState = {
  platform: 'telegram',
  title: '',
  handle: '',
  category: 'news',
  description: '',
  subscribers: '',
  avgViews: '',
  engagementRate: '',
  ageMonths: '',
  monetized: false,
  priceETB: '',
  transferMethods: [],
  url: '',
  siteType: 'content_site',
  techStack: [],
  monthlyVisits: '',
  monthlyPageviews: '',
  monthlyRevenue: '',
  revenueCurrency: 'ETB',
  domainAgeMonths: '',
  domainRegistrar: '',
  hostingProvider: '',
  hostingNotes: '',
};

export default function SellListingPage() {
  const { user } = useAuth();
  const { commissionRate, inspectionHours, usdToEtb } = useAppConfig();
  const blocked = !user?.isVerified;
  const [f, setF] = useState<FormState>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<Listing | null>(null);
  const [techInput, setTechInput] = useState('');

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }));
  const meta = PLATFORM_META[f.platform];
  const isSite = f.platform === 'website';
  const transferOptions = isSite ? WEBSITE_TRANSFER_METHODS : SOCIAL_TRANSFER_METHODS;

  // Social accounts and websites are handed over differently, so changing the type clears the chosen methods.
  function pickPlatform(p: Platform) {
    setF((s) => (s.platform === p ? s : { ...s, platform: p, transferMethods: [] }));
  }
  function addTech(raw: string) {
    const t = raw.trim().slice(0, 30);
    if (!t || f.techStack.length >= 12 || f.techStack.some((x) => x.toLowerCase() === t.toLowerCase())) return setTechInput('');
    set('techStack', [...f.techStack, t]);
    setTechInput('');
  }
  const removeTech = (t: string) => set('techStack', f.techStack.filter((x) => x !== t));
  const revenueETB = (Number(f.monthlyRevenue) || 0) * (f.revenueCurrency === 'USD' ? usdToEtb : 1);

  const estimate = useMemo(
    () =>
      f.platform === 'website'
        ? estimateWebsitePrice({
            monthlyVisits: Number(f.monthlyVisits) || 0,
            monthlyRevenueETB: (Number(f.monthlyRevenue) || 0) * (f.revenueCurrency === 'USD' ? usdToEtb : 1),
            domainAgeMonths: Number(f.domainAgeMonths) || 0,
            includesSource: f.transferMethods.includes('source_code'),
          })
        : estimatePrice({
            platform: f.platform,
            subscribers: Number(f.subscribers),
            avgViews: Number(f.avgViews) || 0,
            engagementRate: Number(f.engagementRate) || 0,
            ageMonths: Number(f.ageMonths) || 0,
            monetized: f.monetized,
          }),
    [f.platform, f.subscribers, f.avgViews, f.engagementRate, f.ageMonths, f.monetized, f.monthlyVisits, f.monthlyRevenue, f.revenueCurrency, f.domainAgeMonths, f.transferMethods, usdToEtb],
  );

  const price = Number(f.priceETB);
  const payout = price > 0 ? price - Math.round(price * commissionRate) : 0;

  function toggleMethod(m: TransferMethod) {
    set('transferMethods', f.transferMethods.includes(m) ? f.transferMethods.filter((x) => x !== m) : [...f.transferMethods, m]);
  }

  // Suggests an engagement rate from the audience and average views when the seller has not typed one.
  function suggestEngagement() {
    const s = Number(f.subscribers);
    const v = Number(f.avgViews);
    if (s > 0 && v >= 0) set('engagementRate', Math.min(100, (v / s) * 100).toFixed(1));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (blocked) return setError('Verify your National ID and phone number before you sell.');
    if (isSite) {
      if (!f.url.trim()) return setError('Enter the website address, for example example.com.');
      if (f.techStack.length === 0) return setError('Add at least one technology used to build the site.');
      if (f.monthlyVisits === '') return setError('Enter the monthly visits (use 0 if the site is new).');
    }
    if (f.transferMethods.length === 0) return setError('Choose at least one transfer method.');
    if (!(price >= 100)) return setError('Enter an asking price of at least 100 ETB.');
    setBusy(true);
    try {
      const r = await api<{ listing: Listing }>('/listings', {
        method: 'POST',
        body: isSite
          ? {
              platform: f.platform,
              title: f.title,
              category: f.category,
              description: f.description,
              priceETB: Math.round(price),
              transferMethods: f.transferMethods,
              website: {
                url: f.url.trim(),
                siteType: f.siteType,
                techStack: f.techStack,
                monthlyVisits: Math.round(Number(f.monthlyVisits)),
                monthlyPageviews: Math.round(Number(f.monthlyPageviews) || 0),
                monthlyRevenue: Number(f.monthlyRevenue) || 0,
                revenueCurrency: f.revenueCurrency,
                domainAgeMonths: Math.round(Number(f.domainAgeMonths) || 0),
                domainRegistrar: f.domainRegistrar.trim(),
                hostingProvider: f.hostingProvider.trim(),
                hostingNotes: f.hostingNotes.trim(),
              },
            }
          : {
              platform: f.platform,
              title: f.title,
              handle: f.handle,
              category: f.category,
              description: f.description,
              subscribers: Math.round(Number(f.subscribers)),
              avgViews: Math.round(Number(f.avgViews)),
              engagementRate: Number(f.engagementRate),
              ageMonths: Math.round(Number(f.ageMonths) || 0),
              monetized: f.monetized,
              priceETB: Math.round(price),
              transferMethods: f.transferMethods,
            },
      });
      setCreated(r.listing);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    return (
      <main className="mx-auto w-full max-w-xl px-4 py-12 text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-100 text-2xl text-emerald-700" aria-hidden="true">
          ✓
        </div>
        <h1 className="mt-4 text-2xl font-extrabold">Listing submitted for review</h1>
        <p className="mt-2 text-slate-600">
          <strong>{created.title}</strong> is now in the moderation queue. After an admin checks the numbers and approves it, it appears in the marketplace.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <button onClick={() => { setCreated(null); setF(EMPTY); }} className="rounded-xl border-2 border-slate-900 px-5 py-2.5 text-sm font-bold hover:bg-slate-900 hover:text-white">
            List another
          </button>
          <Link to="/" className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-700">
            Back to marketplace
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">Sell a channel, account or website</h1>
      <p className="mt-1 text-sm text-slate-600">Truth Market keeps {pct(commissionRate)} of the sale. The buyer pays through Chapa and the rest is locked in escrow for you. It is released when the buyer confirms, or automatically {inspectionHours} hours after you hand over the account if there is no problem.</p>


      {blocked && (
        <div role="alert" className="mt-5 rounded-2xl border-[1.5px] border-amber-400 bg-amber-100 p-4 text-amber-900">
          {user?.kycStatus === 'flagged' ? (
            <>
              <p className="font-extrabold">Your account is on hold</p>
              <p className="mt-1 text-sm">Selling is blocked until our team finishes the identity review. You can still browse and buy.</p>
            </>
          ) : user?.kycStatus === 'pending_review' ? (
            <>
              <p className="font-extrabold">Your ID is being reviewed</p>
              <p className="mt-1 text-sm">You can list as soon as a reviewer approves it.</p>
            </>
          ) : (
            <>
              <p className="font-extrabold">Verify your identity to sell</p>
              <p className="mt-1 text-sm">
                Every seller shows a National ID, confirms the phone number linked to it and enters an SMS code. This protects buyers from fraud.
              </p>
              <Link to="/verify" className="mt-3 inline-block rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700">
                {user?.kycStatus === 'none' ? 'Start verification' : 'Continue verification'}
              </Link>
            </>
          )}
        </div>
      )}

      <form onSubmit={submit} className="mt-6 space-y-6" noValidate>
        <fieldset>
          <legend className="text-sm font-bold">Platform</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {PLATFORMS.map((p) => (
              <label key={p} className={`cursor-pointer rounded-full border px-4 py-2 text-sm font-bold transition ${f.platform === p ? 'border-blue-600 bg-blue-50 text-slate-900 ring-2 ring-blue-600' : 'border-slate-300 hover:border-blue-600'}`}>
                <input type="radio" name="platform" value={p} checked={f.platform === p} onChange={() => pickPlatform(p)} className="sr-only" />
                <span className="inline-flex items-center gap-2">
                  <PlatformIcon platform={p} />
                  {PLATFORM_META[p].label}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-bold sm:col-span-2">
            {isSite ? 'Website or app name' : 'Listing title'}
            <input className={field} value={f.title} onChange={(e) => set('title', e.target.value)} maxLength={120} required placeholder={isSite ? 'e.g. Addis Jobs Board' : 'e.g. Addis News Daily'} />
          </label>

          {isSite ? (
            <label className="text-sm font-bold">
              Website address
              <input className={field} value={f.url} onChange={(e) => set('url', e.target.value)} maxLength={200} required inputMode="url" autoCapitalize="none" spellCheck={false} placeholder="example.com" />
            </label>
          ) : (
            <label className="text-sm font-bold">
              Username / handle
              <input className={field} value={f.handle} onChange={(e) => set('handle', e.target.value)} maxLength={64} required placeholder="@my_channel" />
            </label>
          )}

          {isSite ? (
            <label className="text-sm font-bold">
              Type of site
              <select className={field} value={f.siteType} onChange={(e) => set('siteType', e.target.value as SiteType)}>
                {SITE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {SITE_TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label className="text-sm font-bold">
            Category
            <select className={`${field} capitalize`} value={f.category} onChange={(e) => set('category', e.target.value)}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>

          {isSite ? (
            <>
              <label className="text-sm font-bold">
                Monthly traffic (visits)
                <input className={field} type="number" min={0} inputMode="numeric" value={f.monthlyVisits} onChange={(e) => set('monthlyVisits', e.target.value)} required />
              </label>
              <label className="text-sm font-bold">
                Monthly pageviews
                <input className={field} type="number" min={0} inputMode="numeric" value={f.monthlyPageviews} onChange={(e) => set('monthlyPageviews', e.target.value)} />
              </label>

              <div className="text-sm font-bold">
                <label htmlFor="rev">Monthly revenue</label>
                <div className="mt-1.5 flex gap-2">
                  <input id="rev" className={`${field} mt-0! min-w-0 flex-1`} type="number" min={0} inputMode="decimal" value={f.monthlyRevenue} onChange={(e) => set('monthlyRevenue', e.target.value)} placeholder="0" />
                  <div role="group" aria-label="Revenue currency" className="inline-flex shrink-0 overflow-hidden rounded-xl border border-slate-300">
                    {(['ETB', 'USD'] as const).map((c) => (
                      <button
                        key={c}
                        type="button"
                        aria-pressed={f.revenueCurrency === c}
                        onClick={() => set('revenueCurrency', c)}
                        className={`px-3 text-sm font-bold ${f.revenueCurrency === c ? 'bg-blue-600 text-white' : 'bg-white text-slate-700 hover:bg-slate-100'}`}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                </div>
                {f.revenueCurrency === 'USD' && revenueETB > 0 && (
                  <p className="mt-1 text-xs font-normal text-slate-500">About {formatETB(revenueETB)} per month at 1 USD = {usdToEtb} ETB.</p>
                )}
              </div>
              <label className="text-sm font-bold">
                Domain age (months)
                <input className={field} type="number" min={0} max={420} inputMode="numeric" value={f.domainAgeMonths} onChange={(e) => set('domainAgeMonths', e.target.value)} />
              </label>

              <div className="sm:col-span-2">
                <label htmlFor="tech" className="text-sm font-bold">
                  Tech stack
                </label>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-2.5 py-2 focus-within:border-blue-600 focus-within:ring-2 focus-within:ring-blue-600/20">
                  {f.techStack.map((t) => (
                    <span key={t} className="inline-flex items-center gap-1 rounded-md bg-slate-900 px-2 py-1 font-mono text-xs font-semibold text-white">
                      {t}
                      <button type="button" onClick={() => removeTech(t)} aria-label={`Remove ${t}`} className="text-base leading-none opacity-70 hover:opacity-100">
                        ×
                      </button>
                    </span>
                  ))}
                  <input
                    id="tech"
                    value={techInput}
                    onChange={(e) => setTechInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ',') {
                        e.preventDefault();
                        addTech(techInput);
                      } else if (e.key === 'Backspace' && !techInput && f.techStack.length) {
                        removeTech(f.techStack[f.techStack.length - 1]);
                      }
                    }}
                    onBlur={() => addTech(techInput)}
                    placeholder={f.techStack.length ? 'Add more' : 'Type a technology and press Enter'}
                    maxLength={30}
                    className="min-w-[10rem] flex-1 bg-transparent px-1 py-1 text-sm font-normal outline-none"
                  />
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Suggestions">
                  {TECH_SUGGESTIONS.filter((t) => !f.techStack.some((x) => x.toLowerCase() === t.toLowerCase())).map((t) => (
                    <button key={t} type="button" onClick={() => addTech(t)} className="rounded-full border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:border-blue-600 hover:text-blue-700">
                      + {t}
                    </button>
                  ))}
                </div>
              </div>

              <fieldset className="rounded-2xl border border-slate-200 bg-slate-50 p-3 sm:col-span-2">
                <legend className="px-1 text-sm font-bold">Domain and hosting handover</legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-sm font-bold">
                    Domain registrar
                    <input className={field} value={f.domainRegistrar} onChange={(e) => set('domainRegistrar', e.target.value)} maxLength={60} placeholder="e.g. Namecheap, GoDaddy" />
                  </label>
                  <label className="text-sm font-bold">
                    Hosting provider
                    <input className={field} value={f.hostingProvider} onChange={(e) => set('hostingProvider', e.target.value)} maxLength={60} placeholder="e.g. Vercel, Hostinger, DigitalOcean" />
                  </label>
                  <label className="text-sm font-bold sm:col-span-2">
                    How will hosting, DNS and server access be handed over?
                    <textarea className={field} rows={2} maxLength={500} value={f.hostingNotes} onChange={(e) => set('hostingNotes', e.target.value)} placeholder="e.g. I will transfer the Vercel project and the MongoDB Atlas cluster to your accounts and push the domain with the auth code." />
                  </label>
                </div>
              </fieldset>
            </>
          ) : (
            <>
              <label className="text-sm font-bold">
                {meta.audienceLabel}
                <input className={field} type="number" min={0} inputMode="numeric" value={f.subscribers} onChange={(e) => set('subscribers', e.target.value)} required />
              </label>
              <label className="text-sm font-bold">
                {meta.viewsLabel}
                <input className={field} type="number" min={0} inputMode="numeric" value={f.avgViews} onChange={(e) => set('avgViews', e.target.value)} onBlur={() => !f.engagementRate && suggestEngagement()} required />
              </label>
              <label className="text-sm font-bold">
                Engagement rate (%)
                <input className={field} type="number" min={0} max={100} step="0.1" inputMode="decimal" value={f.engagementRate} onChange={(e) => set('engagementRate', e.target.value)} required />
                <button type="button" onClick={suggestEngagement} className="mt-1 text-xs font-semibold text-blue-700 hover:underline">
                  Calculate from views
                </button>
              </label>
              <label className="text-sm font-bold">
                Account age (months)
                <input className={field} type="number" min={0} max={240} inputMode="numeric" value={f.ageMonths} onChange={(e) => set('ageMonths', e.target.value)} />
              </label>
              <label className="flex items-center gap-2 text-sm font-bold sm:col-span-2">
                <input type="checkbox" checked={f.monetized} onChange={(e) => set('monetized', e.target.checked)} className="h-4 w-4 accent-blue-600" />
                The account is monetized (earns money from the platform)
              </label>
            </>
          )}

          <label className="text-sm font-bold sm:col-span-2">
            Description
            <textarea className={field} rows={4} maxLength={2000} value={f.description} onChange={(e) => set('description', e.target.value)} placeholder={isSite ? 'What the site does, who uses it, how it earns, what is included in the sale.' : 'Audience, content style, countries, anything a buyer should know.'} />
          </label>
        </div>

        <fieldset>
          <legend className="text-sm font-bold">{isSite ? 'What will you hand over?' : 'How will you transfer it?'}</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {transferOptions.map((m) => (
              <label key={m} className={`flex cursor-pointer gap-3 rounded-xl border p-3 transition ${f.transferMethods.includes(m) ? 'border-blue-600 bg-blue-50' : 'border-slate-300 hover:border-blue-400'}`}>
                <input type="checkbox" checked={f.transferMethods.includes(m)} onChange={() => toggleMethod(m)} className="mt-1 h-4 w-4 shrink-0 accent-blue-600" />
                <span>
                  <span className="block text-sm font-bold">{TRANSFER_META[m].label}</span>
                  <span className="block text-xs text-slate-600">{TRANSFER_META[m].hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <section aria-labelledby="price-h" className="rounded-2xl border-[1.5px] border-slate-900 bg-slate-50 p-4">
          <h2 id="price-h" className="text-sm font-bold">
            Price
          </h2>
          {estimate ? (
            <div className="mt-2 rounded-xl bg-white p-3 ring-1 ring-slate-200">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Estimated market value</p>
              <p className="text-xl font-extrabold tabular-nums">
                {formatETB(estimate.low)} - {formatETB(estimate.high)}
              </p>
              <button type="button" onClick={() => set('priceETB', String(estimate.mid))} className="mt-1 text-sm font-bold text-blue-700 hover:underline">
                Use {formatETB(estimate.mid)} as my price
              </button>
              <p className="mt-1 text-xs text-slate-500">{isSite ? 'Based on monthly revenue, traffic, domain age and whether the source code is included. It is a guide, not a guarantee.' : 'Based on audience size, engagement, average views, age and monetization. It is a guide, not a guarantee.'}</p>
            </div>
          ) : (
            <p className="mt-2 text-sm text-slate-500">{isSite ? 'Enter your monthly visits or revenue to see an estimated price.' : 'Enter your audience size to see an estimated price.'}</p>
          )}
          <label className="mt-3 block text-sm font-bold">
            Your asking price (ETB)
            <input className={field} type="number" min={100} inputMode="numeric" value={f.priceETB} onChange={(e) => set('priceETB', e.target.value)} required />
          </label>
          {payout > 0 && (
            <p className="mt-2 text-sm">
              You receive <strong className="tabular-nums">{formatETB(payout)}</strong> after the {pct(commissionRate)} commission.
            </p>
          )}
        </section>

        {error && (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy || blocked} className="w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-blue-700 disabled:opacity-60">
          {busy ? 'Submitting...' : 'Submit for review'}
        </button>
      </form>
    </main>
  );
}
