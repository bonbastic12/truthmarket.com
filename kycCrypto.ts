import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { config } from '../config';
import { ApiError } from '../utils/http';

/**
 * Encrypted blob layout: [12 byte IV][16 byte auth tag][ciphertext]. AES-256-GCM both hides the data and detects any
 * change to it. The owner's user id is bound in as additional data, so a blob copied onto another account fails to open.
 */
function seal(plain: Buffer, ownerId: string): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', config.kyc.encryptionKey, iv);
  c.setAAD(Buffer.from(ownerId));
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]);
}

function open(blob: Buffer, ownerId: string): Buffer {
  if (blob.length < 29) throw new Error('Encrypted data is too short');
  const d = createDecipheriv('aes-256-gcm', config.kyc.encryptionKey, blob.subarray(0, 12));
  d.setAAD(Buffer.from(ownerId));
  d.setAuthTag(blob.subarray(12, 28));
  return Buffer.concat([d.update(blob.subarray(28)), d.final()]);
}

export const encryptText = (text: string, ownerId: string) => seal(Buffer.from(text, 'utf8'), ownerId).toString('base64');
export const decryptText = (b64: string, ownerId: string) => open(Buffer.from(b64, 'base64'), ownerId).toString('utf8');

/** Fingerprint of the ID number: same number gives the same value, but the number cannot be recovered from it. */
export const hashIdNumber = (idNumber: string) => createHmac('sha256', config.kyc.hashKey).update(`id:${idNumber}`).digest('hex');

export const hashOtp = (userId: string, salt: string, code: string) =>
  createHmac('sha256', config.kyc.hashKey).update(`otp:${userId}:${salt}:${code}`).digest('hex');

export function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

/** Reads the real file type from the first bytes. The type the browser claims is ignored. */
export function sniffImage(buf: Buffer): 'image/jpeg' | 'image/png' | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  return null;
}

/** "data:image/jpeg;base64,...." -> checked image bytes. */
export function parseImageDataUrl(dataUrl: string): { bytes: Buffer; mime: 'image/jpeg' | 'image/png' } {
  const m = /^data:image\/(?:jpeg|jpg|png);base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl);
  if (!m) throw new ApiError(400, 'Upload a JPEG or PNG photo of your National ID');
  const bytes = Buffer.from(m[1], 'base64');
  if (bytes.length < config.kyc.imageMinBytes) throw new ApiError(400, 'The photo is too small or blurry. Take a clear, close photo of the whole ID card.');
  if (bytes.length > config.kyc.imageMaxBytes) throw new ApiError(413, 'The photo is too large. The limit is 6 MB.');
  const mime = sniffImage(bytes);
  if (!mime) throw new ApiError(400, 'This file is not a real JPEG or PNG image');
  return { bytes, mime };
}

const FILE_RE = /^[a-f0-9]{32}\.bin$/;
const fileOf = (name: string) => {
  if (!FILE_RE.test(name)) throw new Error('Invalid stored file name');
  return path.join(path.resolve(config.kyc.storageDir), name);
};

export async function storeImage(bytes: Buffer, ownerId: string): Promise<string> {
  const dir = path.resolve(config.kyc.storageDir);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const name = `${randomBytes(16).toString('hex')}.bin`;
  await fs.writeFile(fileOf(name), seal(bytes, ownerId), { mode: 0o600 });
  return name;
}

export async function loadImage(name: string, ownerId: string): Promise<Buffer> {
  return open(await fs.readFile(fileOf(name)), ownerId);
}

export async function deleteImage(name: string | undefined | null): Promise<void> {
  if (!name) return;
  try {
    await fs.unlink(fileOf(name));
  } catch {
    /* already gone */
  }
}
