import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { api, errorMessage, qs } from '../api';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n/I18nContext';
import {
  CATEGORIES, PLATFORMS, PLATFORM_META, SITE_TYPES, SITE_TYPE_LABEL, TECH_SUGGESTIONS,
  type Listing, type ListingPage, type Platform,
} from '../types';
import EscrowCheckoutModal from './EscrowCheckoutModal';
import ListingCard from './ListingCard';
import PlatformIcon from './PlatformIcon';

const COMMON_SORTS = [
  { value: 'newest', label: 'Newest' },
  { value: 'priceAsc', label: 'Price: low to high' },
  { value: 'priceDesc', label: 'Price: high to low' },
] as const;
const SOCIAL_SORTS = [
  ...COMMON_SORTS,
  { value: 'subscribers', label: 'Biggest audience' },
  { value: 'engagement', label: 'Best engagement' },
] as const;
const WEBSITE_SORTS = [
  ...COMMON_SORTS,
  { value: 'traffic', label: 'Most traffic' },
  { value: 'revenue', label: 'Highest revenue' },
] as const;
type SortValue = 'newest' | 'priceAsc' | 'priceDesc' | 'subscribers' | 'engagement' | 'traffic' | 'revenue';

const field =
  'rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20';

export default function Marketplace() {
  const { user } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();

  const rawPlatform = params.get('platform');
  const platform = (PLATFORMS as readonly string[]).includes(rawPlatform ?? '') ? (rawPlatform as Platform) : null;

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [sort, setSort] = useState<SortValue>('newest');
  // Website-only filters
  const [siteType, setSiteType] = useState('');
  const [tech, setTech] = useState('');
  const [minTraffic, setMinTraffic] = useState('');

  const isSite = platform === 'website';
  const sorts = isSite ? WEBSITE_SORTS : SOCIAL_SORTS;
  // The platform can also change through the header links, so keep the sort valid for the current view.
  useEffect(() => {
    setSort((cur) => (sorts.some((o) => o.value === cur) ? cur : 'newest'));
  }, [sorts]);

  const [items, setItems] = useState<Listing[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [buying, setBuying] = useState<Listing | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  // Debounce the search box so we do not query on every key press.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  const load = useCallback(
    async (nextPage: number, append: boolean) => {
      abortRef.current?.abort();
      const ctl = new AbortController();
      abortRef.current = ctl;
      setLoading(true);
      setError('');
      try {
        const r = await api<ListingPage>(
          `/listings${qs({
            platform: platform ?? undefined,
            category,
            search,
            minPrice,
            maxPrice,
            verified: verifiedOnly ? 'true' : undefined,
            sort,
            siteType: isSite ? siteType : undefined,
            tech: isSite ? tech : undefined,
            minTraffic: isSite ? minTraffic : undefined,
            page: nextPage,
            limit: 12,
          })}`,
          { signal: ctl.signal },
        );
        setItems((prev) => (append ? [...prev, ...r.items] : r.items));
        setTotal(r.total);
        setPage(r.page);
        setPages(r.pages);
        setLoading(false);
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
        setError(errorMessage(e));
        setLoading(false);
      }
    },
    [platform, isSite, category, search, minPrice, maxPrice, verifiedOnly, sort, siteType, tech, minTraffic],
  );

  // Any filter change starts again from page 1.
  useEffect(() => {
    load(1, false);
    return () => abortRef.current?.abort();
  }, [load]);

  function pickPlatform(p: Platform | null) {
    const next = new URLSearchParams(params);
    if (p) next.set('platform', p);
    else next.delete('platform');
    setParams(next);
    // Each kind of listing has its own filters and sort options: drop the ones that no longer apply.
    if (p !== 'website') {
      setSiteType('');
      setTech('');
      setMinTraffic('');
      if (sort === 'traffic' || sort === 'revenue') setSort('newest');
    } else if (sort === 'subscribers' || sort === 'engagement') {
      setSort('newest');
    }
  }

  function startBuy(l: Listing) {
    if (!user) {
      navigate('/login', { state: { from: location.pathname + location.search } });
      return;
    }
    setBuying(l);
  }

  const sellerId = (l: Listing) => (typeof l.seller === 'string' ? l.seller : l.seller._id);
  const tabBase = 'shrink-0 snap-start whitespace-nowrap rounded-full border px-3.5 py-2 text-sm font-bold transition-colors sm:px-4';

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-6">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
            {isSite ? t('Websites & web apps') : t('Verified channels, accounts & websites')}
          </h1>
          <p className="text-sm text-slate-600">
            {isSite
              ? t('Traffic, revenue and tech stack shown up front. Domain, hosting and code are handed over under escrow. Prices in Ethiopian Birr.')
              : t('Every purchase is protected by escrow. Prices in Ethiopian Birr.')}
          </p>
        </div>
        <p className="text-sm font-semibold text-slate-500" aria-live="polite">
          {loading && items.length === 0 ? t('Loading...') : `${total} ${total === 1 ? t('listing') : t('listings')}`}
        </p>
      </div>

      <div className="sticky top-[3.4rem] z-20 -mx-4 mt-4 border-b border-slate-200 bg-white/95 px-4 py-2.5 backdrop-blur sm:top-[3.6rem] md:static md:mx-0 md:border-0 md:bg-transparent md:px-0 md:py-0 md:backdrop-blur-none">
      <div className="no-scrollbar flex snap-x gap-2 overflow-x-auto md:pb-1" role="tablist" aria-label={t('Platform filter')}>
        <button
          role="tab"
          aria-selected={!platform}
          onClick={() => pickPlatform(null)}
          className={`${tabBase} ${!platform ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 hover:border-slate-900'}`}
        >
          {t('All platforms')}
        </button>
        {PLATFORMS.map((p) => (
          <button
            key={p}
            role="tab"
            aria-selected={platform === p}
            onClick={() => pickPlatform(p)}
            className={`${tabBase} inline-flex items-center gap-2 ${platform === p ? 'border-blue-600 bg-blue-50 text-slate-900 ring-2 ring-blue-600' : 'border-slate-300 hover:border-blue-600'}`}
          >
            <PlatformIcon platform={p} />
            {p === 'website' ? t('Websites & Apps') : PLATFORM_META[p].label}
          </button>
        ))}
      </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <input
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder={isSite ? t('Search name, domain or technology') : t('Search name or @handle')}
          aria-label={t('Search listings')}
          className={`${field} sm:col-span-2`}
        />
        <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label={t('Category')} className={field}>
          <option value="">{t('All categories')}</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {t(c)}
            </option>
          ))}
        </select>
        <input type="number" min={0} inputMode="numeric" value={minPrice} onChange={(e) => setMinPrice(e.target.value)} placeholder={t('Min ETB')} aria-label="Minimum price" className={field} />
        <input type="number" min={0} inputMode="numeric" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} placeholder={t('Max ETB')} aria-label="Maximum price" className={field} />
        <select value={sort} onChange={(e) => setSort(e.target.value as SortValue)} aria-label={t('Sort')} className={field}>
          {sorts.map((s) => (
            <option key={s.value} value={s.value}>
              {t(s.label)}
            </option>
          ))}
        </select>
      </div>
      {isSite && (
        <fieldset className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
          <legend className="px-1 text-xs font-bold uppercase tracking-wide text-slate-500">{t('Website filters')}</legend>
          <div className="grid gap-3 sm:grid-cols-3">
            <select value={siteType} onChange={(e) => setSiteType(e.target.value)} aria-label="Site type" className={field}>
              <option value="">{t('All site types')}</option>
              {SITE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {SITE_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={0}
              inputMode="numeric"
              value={minTraffic}
              onChange={(e) => setMinTraffic(e.target.value)}
              placeholder={t('Min visits per month')}
              aria-label="Minimum monthly visits"
              className={field}
            />
            <select value={TECH_SUGGESTIONS.includes(tech as never) ? tech : ''} onChange={(e) => setTech(e.target.value)} aria-label="Tech stack" className={field}>
              <option value="">{t('Any tech stack')}</option>
              {TECH_SUGGESTIONS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        </fieldset>
      )}
      <label className="mt-3 inline-flex items-center gap-2 text-sm font-semibold">
        <input type="checkbox" checked={verifiedOnly} onChange={(e) => setVerifiedOnly(e.target.checked)} className="h-4 w-4 accent-blue-600" />
        {t('Verified only')}
      </label>

      {error && (
        <div role="alert" className="mt-6 flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          <span>{error}</span>
          <button onClick={() => load(1, false)} className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold text-white">
            {t('Try again')}
          </button>
        </div>
      )}

      {!error && !loading && items.length === 0 && (
        <p className="mt-12 text-center text-slate-500">{t('No listings match these filters. Clear a filter or try another word.')}</p>
      )}

      <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((l) => (
          <ListingCard key={l._id} listing={l} isOwn={!!user && sellerId(l) === user.id} onBuy={startBuy} />
        ))}
        {loading &&
          items.length === 0 &&
          Array.from({ length: 6 }, (_, i) => <div key={i} className="h-72 animate-pulse rounded-2xl bg-slate-100" aria-hidden="true" />)}
      </div>

      {page < pages && (
        <div className="mt-8 text-center">
          <button
            onClick={() => load(page + 1, true)}
            disabled={loading}
            className="rounded-xl border-2 border-slate-900 px-6 py-2.5 text-sm font-bold transition hover:bg-slate-900 hover:text-white disabled:opacity-50"
          >
            {loading ? t('Loading...') : t('Load more')}
          </button>
        </div>
      )}

      {buying && <EscrowCheckoutModal listing={buying} onClose={() => setBuying(null)} />}
    </main>
  );
}
