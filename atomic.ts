import mongoose, { ClientSession } from 'mongoose';

/** True when the database is a single MongoDB server that cannot run transactions (local development). */
function transactionsUnsupported(e: unknown): boolean {
  const err = e as { code?: number; codeName?: string; message?: string };
  return err?.code === 20 || err?.codeName === 'IllegalOperation' || /replica set|Transaction numbers/i.test(err?.message ?? '');
}

/**
 * Runs `work` as ONE all-or-nothing database transaction: if anything inside throws, every write inside is rolled back.
 * MongoDB Atlas (and any replica set) supports this. A lone local `mongod` does not, so there the same code runs without
 * a transaction; it stays safe because every write is also guarded by an atomic status change and a unique ledger index,
 * and the sweeper repairs any half-finished payment.
 *
 * `work` may run again if MongoDB asks for a retry, so it must only write to the database through the given session.
 */
export async function runAtomic<T>(work: (session?: ClientSession) => Promise<T>): Promise<T> {
  let session: ClientSession | undefined;
  try {
    session = await mongoose.startSession();
    let out!: T;
    await session.withTransaction(async () => {
      out = await work(session);
    });
    return out;
  } catch (e) {
    if (transactionsUnsupported(e)) return work(undefined);
    throw e;
  } finally {
    await session?.endSession();
  }
}
