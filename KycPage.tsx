import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../api';
import { useAuth } from '../auth/AuthContext';
import type { KycState } from '../types';

const field =
  'mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm font-normal outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20';

/** Shrinks the photo (long side 1800px) and re-saves it as JPEG. Smaller upload, and the camera's location data is dropped. */
function prepareImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 1800 / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('This browser cannot prepare the photo'));
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('This file is not a readable image. Choose a JPEG or PNG photo.'));
    };
    img.src = url;
  });
}

function Steps({ current }: { current: 1 | 2 | 3 }) {
  const items = ['National ID', 'SMS code', 'Review'];
  return (
    <ol className="mt-4 flex gap-2 text-xs font-bold" aria-label="Verification steps">
      {items.map((t, i) => (
        <li key={t} aria-current={current === i + 1 ? 'step' : undefined} className={`flex-1 rounded-full px-3 py-1.5 text-center ${current > i + 1 ? 'bg-emerald-100 text-emerald-800' : current === i + 1 ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
          {i + 1}. {t}
        </li>
      ))}
    </ol>
  );
}

export default function KycPage() {
  const { user, refresh } = useAuth();
  const [kyc, setKyc] = useState<KycState | null>(null);
  const [loadError, setLoadError] = useState('');
  const [editing, setEditing] = useState(false);

  const [fullName, setFullName] = useState(user?.name ?? '');
  const [idNumber, setIdNumber] = useState('');
  const [idPhone, setIdPhone] = useState(user?.phone ?? '');
  const [photo, setPhoto] = useState('');
  const [photoName, setPhotoName] = useState('');
  const [consent, setConsent] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setKyc(await api<KycState>('/kyc/status'));
      setLoadError('');
    } catch (e) {
      setLoadError(errorMessage(e));
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  // Ticks only while the resend countdown is running.
  const resendMs = kyc?.resendAt ? new Date(kyc.resendAt).getTime() - now : 0;
  useEffect(() => {
    if (resendMs <= 0) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [resendMs > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setError('');
    try {
      setPhoto(await prepareImage(f));
      setPhotoName(f.name);
    } catch (err) {
      setPhoto('');
      setPhotoName('');
      setError(errorMessage(err));
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setNotice('');
    if (!photo) return setError('Add a clear photo of your National ID.');
    if (!consent) return setError('Please confirm that you agree to the identity check.');
    setBusy(true);
    try {
      const r = await api<{ status: string; otpSent: boolean; reason?: string; kyc: KycState }>('/kyc/submit', {
        method: 'POST',
        body: { fullName, idNumber, idPhone, imageDataUrl: photo },
      });
      setKyc(r.kyc);
      setNow(Date.now());
      setEditing(false);
      setPhoto('');
      setIdNumber('');
      setCode('');
      if (r.status === 'flagged') await refresh();
      else setNotice(r.otpSent ? 'We sent a 6 digit code to your phone.' : 'Your ID was saved. Press "Send code" to get your SMS code.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function sendCode() {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      await api('/kyc/otp/send', { method: 'POST', body: {} });
      await load();
      setNow(Date.now());
      setNotice('A new code is on its way.');
    } catch (err) {
      setError(errorMessage(err));
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const r = await api<{ kyc: KycState }>('/kyc/otp/verify', { method: 'POST', body: { code } });
      setKyc(r.kyc);
      setCode('');
    } catch (err) {
      setError(errorMessage(err));
      await load();
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  // Keep the account badge in step once an admin decides.
  useEffect(() => {
    if (kyc && kyc.isVerified !== user?.isVerified) refresh();
  }, [kyc, user?.isVerified, refresh]);

  if (loadError) {
    return (
      <main className="mx-auto w-full max-w-xl px-4 py-10">
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{loadError}</p>
        <button onClick={load} className="mt-3 rounded-xl border-2 border-slate-900 px-4 py-2 text-sm font-bold">Try again</button>
      </main>
    );
  }
  if (!kyc) return <p className="p-10 text-center text-slate-500">Loading...</p>;

  const showForm = kyc.status === 'none' || kyc.status === 'rejected' || (kyc.status === 'otp_pending' && editing);
  const step: 1 | 2 | 3 = showForm ? 1 : kyc.status === 'otp_pending' ? 2 : 3;

  return (
    <main className="mx-auto w-full max-w-xl px-4 py-8">
      <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">Verify your identity</h1>
      <p className="mt-1 text-sm text-slate-600">
        Sellers must prove who they are before they can list or hand over an account. It protects buyers from fraud.{' '}
        <Link to="/privacy" className="font-semibold text-blue-700 hover:underline">How we protect your ID</Link>
      </p>
      <Steps current={step} />

      {error && (
        <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>
      )}
      {notice && (
        <p role="status" className="mt-4 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">{notice}</p>
      )}

      {kyc.status === 'rejected' && (
        <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <strong>Your last submission was not accepted.</strong> {kyc.rejectionReason} Please submit it again.
        </p>
      )}

      {showForm && (
        <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
          <label className="block text-sm font-bold">
            Full name as printed on the ID
            <input className={field} value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" required />
          </label>
          <label className="block text-sm font-bold">
            National ID number (FIN)
            <input className={field} value={idNumber} onChange={(e) => setIdNumber(e.target.value)} inputMode="numeric" autoComplete="off" placeholder="16 digits" required />
          </label>
          <label className="block text-sm font-bold">
            Phone number linked to your National ID
            <input className={field} type="tel" value={idPhone} onChange={(e) => setIdPhone(e.target.value)} autoComplete="tel" placeholder="09XXXXXXXX" required />
            <span className="mt-1 block text-xs font-normal text-slate-500">
              It must be the same number as your Truth Market account ({user?.phone}). If the numbers differ, the account is put on hold. The SMS code goes to this number.
            </span>
          </label>

          <div>
            <p className="text-sm font-bold">Photo of your National ID</p>
            <input ref={fileRef} id="id-photo" type="file" accept="image/jpeg,image/png" capture="environment" onChange={onFile} className="sr-only" />
            <button type="button" onClick={() => fileRef.current?.click()} className="mt-1.5 flex w-full items-center justify-between gap-3 rounded-xl border-2 border-dashed border-slate-300 px-4 py-3 text-left text-sm hover:border-blue-600">
              <span className="min-w-0 truncate font-semibold">{photoName || 'Take or choose a photo'}</span>
              <span className="shrink-0 rounded-lg bg-blue-600 px-3 py-1 text-xs font-bold text-white">{photo ? 'Change' : 'Upload'}</span>
            </button>
            {photo && <img src={photo} alt="Preview of the ID photo you chose" className="mt-3 max-h-56 rounded-xl border border-slate-200 object-contain" />}
            <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-slate-500">
              <li>The whole card is visible, flat, in good light, with no glare.</li>
              <li>All text and the photo are sharp enough to read.</li>
              <li>An original card, not a screenshot or a photocopy.</li>
            </ul>
          </div>

          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-blue-600" />
            <span>
              I agree that Truth Market checks my National ID and phone number to prevent fraud, as described in the{' '}
              <Link to="/privacy" className="font-semibold text-blue-700 hover:underline">Privacy Policy</Link>.
            </span>
          </label>

          <button type="submit" disabled={busy} className="w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-blue-700 disabled:opacity-60">
            {busy ? 'Sending...' : 'Continue'}
          </button>
          {kyc.status === 'otp_pending' && (
            <button type="button" onClick={() => setEditing(false)} className="w-full text-sm font-semibold text-slate-600 hover:underline">Back to the SMS code</button>
          )}
        </form>
      )}

      {kyc.status === 'otp_pending' && !editing && (
        <form onSubmit={verify} className="mt-6 space-y-4" noValidate>
          <p className="text-sm">
            Enter the 6 digit code we sent by SMS to <strong className="tabular-nums">{kyc.phone}</strong>.
          </p>
          <label className="block text-sm font-bold">
            SMS code
            <input
              className={`${field} text-center text-2xl font-bold tracking-[0.5em] tabular-nums`}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="000000"
              required
            />
          </label>
          <button type="submit" disabled={busy || code.length !== 6} className="w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-blue-700 disabled:opacity-60">
            {busy ? 'Checking...' : 'Verify code'}
          </button>
          <div className="flex items-center justify-between text-sm">
            <button type="button" onClick={sendCode} disabled={busy || resendMs > 0} className="font-bold text-blue-700 hover:underline disabled:text-slate-400 disabled:no-underline">
              {resendMs > 0 ? `Send a new code in ${Math.ceil(resendMs / 1000)}s` : kyc.otpExpiresAt ? 'Send a new code' : 'Send code'}
            </button>
            <button type="button" onClick={() => setEditing(true)} className="font-semibold text-slate-600 hover:underline">Change my details</button>
          </div>
          <p className="text-xs text-slate-500">After 5 wrong codes the account is put on hold for review.</p>
        </form>
      )}

      {kyc.status === 'pending_review' && (
        <section className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-5">
          <h2 className="text-lg font-extrabold">Your phone is confirmed. We are checking your ID.</h2>
          <p className="mt-1 text-sm text-slate-600">
            A Truth Market reviewer compares your ID photo with the details you entered. You can sell as soon as it is approved. Name on file: <strong>{kyc.fullNameOnId}</strong>, ID ending <strong className="tabular-nums">{kyc.idLast4}</strong>.
          </p>
          <button onClick={load} className="mt-3 rounded-xl border-2 border-slate-900 px-4 py-2 text-sm font-bold hover:bg-slate-900 hover:text-white">Check status</button>
        </section>
      )}

      {kyc.status === 'verified' && (
        <section className="mt-6 rounded-2xl border border-emerald-300 bg-emerald-50 p-5">
          <h2 className="text-lg font-extrabold text-emerald-800">You are verified</h2>
          <p className="mt-1 text-sm text-emerald-900">You can now create listings and hand over accounts. Your phone number must stay the same as the one linked to your ID.</p>
          <Link to="/sell" className="mt-3 inline-block rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-700">Sell a channel or website</Link>
        </section>
      )}

      {kyc.status === 'flagged' && (
        <section role="alert" className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-5">
          <h2 className="text-lg font-extrabold text-red-800">Your account is on hold</h2>
          <p className="mt-1 text-sm text-red-800">
            The identity details did not pass an automatic check (for example the phone numbers did not match, the ID is already used, or too many wrong codes were entered). Selling is blocked until our team reviews your account. You can still browse and buy.
          </p>
        </section>
      )}
    </main>
  );
}
