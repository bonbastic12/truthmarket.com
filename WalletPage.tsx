import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../api';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n/I18nContext';
import { formatDate, formatETB } from '../lib/format';
import SellerEarningsSection from './SellerEarnings';
import { PAYOUT_LABEL, PAYOUT_METHODS, WALLET_PAYOUT_METHODS, type PayoutMethod, type Wallet, type WithdrawalRow } from '../types';

const field =
  'mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm font-normal outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 disabled:cursor-not-allowed disabled:opacity-60';

const STATUS_STYLE: Record<WithdrawalRow['status'], string> = {
  requested: 'bg-amber-100 text-amber-900',
  paid: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-red-100 text-red-800',
};

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'main' }) {
  return (
    <div className={`rounded-2xl border-[1.5px] p-4 ${tone === 'main' ? 'border-blue-600 bg-blue-50' : 'border-slate-200 bg-white'}`}>
      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 truncate text-xl font-extrabold tabular-nums sm:text-2xl">{formatETB(value)}</p>
    </div>
  );
}

/**
 * Seller wallet. The server decides everything (balance from the ledger, the National ID + phone rule,
 * the SMS code); this page only shows it and sends the request. When the identity check is not complete the
 * form is replaced by a clear way to finish it, and the server would refuse the request anyway.
 */
export default function WalletPage() {
  const { user } = useAuth();
  const { t } = useI18n();
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [rows, setRows] = useState<WithdrawalRow[]>([]);
  const [loadError, setLoadError] = useState('');

  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PayoutMethod>('telebirr');
  const [accountName, setAccountName] = useState(user?.name ?? '');
  const [accountNumber, setAccountNumber] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await api<{ wallet: Wallet; withdrawals: WithdrawalRow[] }>('/wallet');
      setWallet(r.wallet);
      setRows(r.withdrawals);
      setLoadError('');
    } catch (e) {
      setLoadError(errorMessage(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (resendAt <= Date.now()) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [resendAt]);

  const verified = !!user?.isVerified; // the server applies the same rule to everyone, admins included
  const isWallet = WALLET_PAYOUT_METHODS.includes(method);
  const wait = Math.max(0, Math.ceil((resendAt - now) / 1000));

  async function sendCode() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const r = await api<{ resendAt: string }>('/wallet/withdraw/code', { method: 'POST' });
      setCodeSent(true);
      setResendAt(new Date(r.resendAt).getTime());
      setNow(Date.now());
      setNotice(t('Code sent. It works for 5 minutes.'));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const r = await api<{ wallet: Wallet }>('/wallet/withdraw', {
        method: 'POST',
        body: { amountETB: Number(amount), method, accountName: accountName.trim(), accountNumber: accountNumber.trim(), code },
      });
      setWallet(r.wallet);
      setAmount('');
      setCode('');
      setCodeSent(false);
      setNotice(t('Withdrawal requested. We will pay it after a check.'));
      void load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6">
      <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">{t('Wallet balance')}</h1>

      {loadError && (
        <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {loadError}{' '}
          <button className="font-bold underline" onClick={() => void load()}>{t('Try again')}</button>
        </p>
      )}

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat tone="main" label={t('Available to withdraw')} value={wallet?.availableETB ?? 0} />
        <Stat label={t('Locked in escrow')} value={wallet?.lockedETB ?? 0} />
        <Stat label={t('Pending withdrawal')} value={wallet?.pendingETB ?? 0} />
        <Stat label={t('Paid out')} value={wallet?.paidETB ?? 0} />
      </div>
      <p className="mt-2 text-xs text-slate-500">{t("Money from a sale unlocks after the buyer's inspection window.")}</p>

      {!verified ? (
        <section className="mt-6 rounded-2xl border-[1.5px] border-amber-500 bg-amber-100 p-5 text-amber-900" aria-labelledby="kyc-gate">
          <h2 id="kyc-gate" className="text-lg font-extrabold">{t('Identity check needed')}</h2>
          <p className="mt-1 text-sm">
            {user?.kycStatus === 'flagged'
              ? t('Account on hold')
              : t('To protect buyers and your money, withdrawals open only after your National ID is verified and your account phone matches the phone linked to it.')}
          </p>
          <Link to="/verify" className="mt-4 inline-block rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-700">
            {t('Verify my identity')}
          </Link>
        </section>
      ) : (
        <form onSubmit={submit} className="mt-6 rounded-2xl border-[1.5px] border-slate-900 bg-white p-5" aria-labelledby="wd-title">
          <h2 id="wd-title" className="text-lg font-extrabold">{t('Withdraw money')}</h2>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-bold">
              {t('Amount (ETB)')}
              <input type="number" inputMode="numeric" min={wallet?.minWithdrawalETB ?? 1} step={1} required value={amount} onChange={(e) => setAmount(e.target.value)} className={field} />
            </label>
            <label className="text-sm font-bold">
              {t('Pay out to')}
              <select value={method} onChange={(e) => setMethod(e.target.value as PayoutMethod)} className={field}>
                {PAYOUT_METHODS.map((m) => (
                  <option key={m} value={m}>{PAYOUT_LABEL[m]}</option>
                ))}
              </select>
            </label>
            <label className="text-sm font-bold">
              {t('Account holder name')}
              <input required minLength={3} maxLength={80} value={accountName} onChange={(e) => setAccountName(e.target.value)} className={field} autoComplete="name" />
            </label>
            <label className="text-sm font-bold">
              {t('Account / phone number')}
              <input
                required
                inputMode={isWallet ? 'tel' : 'numeric'}
                placeholder={isWallet ? '09XXXXXXXX' : ''}
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value)}
                className={field}
                autoComplete="off"
              />
            </label>
          </div>

          <div className="mt-4 flex flex-wrap items-end gap-3">
            <label className="min-w-[10rem] flex-1 text-sm font-bold">
              {t('Confirmation code')}
              <input required inputMode="numeric" pattern="\d{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} disabled={!codeSent} className={`${field} tracking-[0.4em]`} autoComplete="one-time-code" />
            </label>
            <button
              type="button"
              onClick={() => void sendCode()}
              disabled={busy || wait > 0}
              className="rounded-xl border-2 border-slate-900 px-4 py-2.5 text-sm font-bold transition hover:bg-slate-900 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {wait > 0 ? `${t('Send code to my verified phone')} (${wait})` : t('Send code to my verified phone')}
            </button>
          </div>

          {error && <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</p>}
          {notice && <p role="status" className="mt-4 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">{notice}</p>}

          <button type="submit" disabled={busy || !codeSent || code.length !== 6} className="mt-5 w-full rounded-xl bg-blue-600 px-5 py-3 text-sm font-extrabold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300 sm:w-auto">
            {busy ? t('Loading...') : t('Request withdrawal')}
          </button>
        </form>
      )}

      <section className="mt-8" aria-labelledby="wd-history">
        <h2 id="wd-history" className="text-lg font-extrabold">{t('Withdrawal history')}</h2>
        {rows.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">{t('No withdrawals yet.')}</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 bg-white">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <div className="min-w-0">
                  <p className="font-extrabold tabular-nums">{formatETB(r.amountETB)}</p>
                  <p className="truncate text-xs text-slate-500">
                    {PAYOUT_LABEL[r.method]} ••{r.accountLast4} · {formatDate(r.createdAt)}
                  </p>
                  {r.rejectionReason && <p className="text-xs text-red-700">{r.rejectionReason}</p>}
                  {r.paymentReference && <p className="text-xs text-slate-500">Ref {r.paymentReference}</p>}
                </div>
                <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${STATUS_STYLE[r.status]}`}>{t(r.status)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <SellerEarningsSection />
    </main>
  );
}
