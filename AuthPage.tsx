import { useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { errorMessage } from '../api';
import { useAuth } from './AuthContext';

const input =
  'w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20';

export default function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const { user, login, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (user) return <Navigate to={from} replace />;

  const set = (k: keyof typeof form) => (e: ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (mode === 'login') await login(form.email, form.password);
      else await register(form);
      navigate(from, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const isLogin = mode === 'login';
  return (
    <main className="mx-auto w-full max-w-md px-4 py-10">
      <h1 className="text-2xl font-extrabold tracking-tight">{isLogin ? 'Log in' : 'Create your account'}</h1>
      <p className="mt-1 text-sm text-slate-600">
        {isLogin ? 'Welcome back to Truth Market.' : 'Buy and sell verified channels with escrow protection.'}
      </p>

      <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
        {!isLogin && (
          <label className="block text-sm font-semibold">
            Full name
            <input className={`${input} mt-1.5 font-normal`} value={form.name} onChange={set('name')} autoComplete="name" required />
          </label>
        )}
        <label className="block text-sm font-semibold">
          Email
          <input className={`${input} mt-1.5 font-normal`} type="email" value={form.email} onChange={set('email')} autoComplete="email" required />
        </label>
        {!isLogin && (
          <label className="block text-sm font-semibold">
            Phone number
            <input className={`${input} mt-1.5 font-normal`} type="tel" placeholder="09XXXXXXXX" value={form.phone} onChange={set('phone')} autoComplete="tel" required />
          </label>
        )}
        <label className="block text-sm font-semibold">
          Password
          <input
            className={`${input} mt-1.5 font-normal`}
            type="password"
            value={form.password}
            onChange={set('password')}
            autoComplete={isLogin ? 'current-password' : 'new-password'}
            required
          />
          {!isLogin && <span className="mt-1 block text-xs font-normal text-slate-500">At least 8 characters with a letter and a number.</span>}
        </label>

        {error && (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? 'Please wait...' : isLogin ? 'Log in' : 'Create account'}
        </button>
      </form>

      <p className="mt-5 text-center text-sm text-slate-600">
        {isLogin ? 'New to Truth Market?' : 'Already have an account?'}{' '}
        <Link to={isLogin ? '/register' : '/login'} state={location.state} className="font-bold text-blue-700 hover:underline">
          {isLogin ? 'Create an account' : 'Log in'}
        </Link>
      </p>
    </main>
  );
}
