import { useCallback, useEffect, useState } from 'react';
import { api, apiImageUrl, errorMessage, qs } from '../api';
import { formatDate } from '../lib/format';

type Queue = 'pending_review' | 'flagged' | 'otp_pending' | 'verified' | 'rejected';
const QUEUES: { id: Queue; label: string }[] = [
  { id: 'pending_review', label: 'Ready to review' },
  { id: 'flagged', label: 'Flagged' },
  { id: 'otp_pending', label: 'Waiting for SMS code' },
  { id: 'verified', label: 'Verified' },
  { id: 'rejected', label: 'Rejected' },
];

interface Item {
  id: string;
  name: string;
  email: string;
  accountPhone: string;
  idPhone?: string;
  phoneMatches: boolean;
  idLast4?: string;
  fullNameOnId?: string;
  flags: { code: string; note?: string; at: string }[];
  submittedAt?: string;
  status: string;
}

interface Review {
  id: string;
  name: string;
  email: string;
  accountPhone: string;
  status: string;
  fullNameOnId?: string;
  idPhone?: string;
  idNumber: string | null;
  phoneMatches: boolean;
  otpVerified: boolean;
  flags: { code: string; note?: string; at: string }[];
  submittedAt?: string;
  rejectionReason?: string;
}

const FLAG_LABEL: Record<string, string> = {
  phone_mismatch: 'Phone does not match',
  duplicate_identity: 'ID number already used',
  otp_attempts: 'Too many wrong codes',
};

const btn = 'rounded-lg px-3 py-1.5 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-50';

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${ok ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>
      <span aria-hidden="true">{ok ? '✓' : '✕'}</span>
      {label}
    </span>
  );
}

export default function KycReviewPanel() {
  const [queue, setQueue] = useState<Queue>('pending_review');
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [imageUrl, setImageUrl] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setItems((await api<{ items: Item[] }>(`/kyc/admin/queue${qs({ status: queue })}`)).items);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [queue]);
  useEffect(() => {
    load();
  }, [load]);

  // The ID photo is a temporary in-memory URL: free it as soon as it is closed.
  useEffect(() => () => { if (imageUrl) URL.revokeObjectURL(imageUrl); }, [imageUrl]);

  async function openItem(id: string) {
    if (open === id) return closeItem();
    closeItem();
    setOpen(id);
    setError('');
    try {
      const [r, url] = await Promise.all([
        api<{ review: Review }>(`/kyc/admin/${id}`),
        apiImageUrl(`/kyc/admin/${id}/image`).catch(() => ''),
      ]);
      setReview(r.review);
      setImageUrl(url);
    } catch (e) {
      setError(errorMessage(e));
      setOpen(null);
    }
  }
  function closeItem() {
    setOpen(null);
    setReview(null);
    setImageUrl('');
    setReason('');
  }

  async function decide(id: string, decision: 'approve' | 'reject' | 'reset') {
    setBusy(true);
    setError('');
    try {
      await api(`/kyc/admin/${id}/decision`, { method: 'POST', body: { decision, reason: reason || undefined } });
      closeItem();
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Identity verification">
      <div className="no-scrollbar mt-4 flex gap-2 overflow-x-auto" role="tablist" aria-label="Identity queues">
        {QUEUES.map((q) => (
          <button key={q.id} role="tab" aria-selected={queue === q.id} onClick={() => { closeItem(); setQueue(q.id); }} className={`whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm font-bold ${queue === q.id ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 hover:border-blue-600'}`}>
            {q.label}
          </button>
        ))}
      </div>

      {error && <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>}
      {loading && <p className="mt-6 text-sm text-slate-500">Loading...</p>}
      {!loading && items.length === 0 && <p className="mt-10 text-center text-slate-500">Nobody in this list.</p>}

      <ul className="mt-4 space-y-3">
        {items.map((it) => (
          <li key={it.id} className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-bold">{it.name} <span className="font-normal text-slate-500">· {it.email}</span></p>
                <p className="text-sm text-slate-600">
                  Name on ID: <strong>{it.fullNameOnId ?? '-'}</strong> · ID ending <span className="tabular-nums">{it.idLast4 ?? '-'}</span>
                  {it.submittedAt && <> · sent {formatDate(it.submittedAt)}</>}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Check ok={it.phoneMatches} label={it.phoneMatches ? 'Phone matches' : 'Phone differs'} />
                  {it.flags.map((f) => (
                    <span key={f.code} className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-bold text-red-800">{FLAG_LABEL[f.code] ?? f.code}</span>
                  ))}
                </div>
              </div>
              <button onClick={() => openItem(it.id)} aria-expanded={open === it.id} className={`${btn} border-2 border-slate-900 hover:bg-slate-900 hover:text-white`}>
                {open === it.id ? 'Close' : 'Open ID'}
              </button>
            </div>

            {open === it.id && (
              <div className="mt-4 grid gap-4 border-t border-slate-200 pt-4 md:grid-cols-2">
                <div>
                  {imageUrl ? (
                    <img src={imageUrl} alt={`National ID photo of ${it.name}`} className="max-h-96 w-full rounded-xl border border-slate-200 object-contain" />
                  ) : (
                    <p className="rounded-xl bg-slate-50 p-6 text-center text-sm text-slate-500">No photo stored.</p>
                  )}
                  <p className="mt-1 text-xs text-slate-500">Opening this photo is written to the audit log.</p>
                </div>
                <div className="space-y-3">
                  {!review ? (
                    <p className="text-sm text-slate-500">Decrypting...</p>
                  ) : (
                    <>
                      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
                        <dt className="text-slate-500">Name on ID</dt><dd className="font-semibold">{review.fullNameOnId}</dd>
                        <dt className="text-slate-500">ID number</dt><dd className="font-mono font-semibold tabular-nums">{review.idNumber}</dd>
                        <dt className="text-slate-500">Account phone</dt><dd className="font-semibold tabular-nums">{review.accountPhone}</dd>
                        <dt className="text-slate-500">Phone linked to ID</dt><dd className="font-semibold tabular-nums">{review.idPhone}</dd>
                        <dt className="text-slate-500">Account name</dt><dd className="font-semibold">{review.name}</dd>
                      </dl>
                      <div className="flex flex-wrap gap-1.5">
                        <Check ok={review.phoneMatches} label="Phones match" />
                        <Check ok={review.otpVerified} label="SMS code passed" />
                      </div>
                      <p className="text-xs text-slate-500">Compare the photo with the name and number above. The ID must be a real, undamaged original and the name must match the account.</p>
                      <label className="block text-xs font-bold">
                        Reason (needed to reject)
                        <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal outline-none focus:border-blue-600" placeholder="For example: the photo is blurry" />
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {review.status === 'pending_review' && (
                          <button disabled={busy || !review.phoneMatches || !review.otpVerified} onClick={() => decide(it.id, 'approve')} className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`}>Approve seller</button>
                        )}
                        {['pending_review', 'verified', 'flagged', 'otp_pending'].includes(review.status) && (
                          <button disabled={busy || reason.trim().length < 3} onClick={() => decide(it.id, 'reject')} className={`${btn} bg-red-600 text-white hover:bg-red-700`}>Reject (delete ID data)</button>
                        )}
                        {['flagged', 'rejected'].includes(review.status) && (
                          <button disabled={busy} onClick={() => decide(it.id, 'reset')} className={`${btn} border-2 border-slate-900 hover:bg-slate-900 hover:text-white`}>Clear and let them retry</button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
