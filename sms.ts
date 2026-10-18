import { config } from '../config';
import { ApiError } from '../utils/http';
import { maskPhone, toInternational } from '../utils/phone';

/** Sends one SMS to an Ethiopian mobile number (09xxxxxxxx). Throws ApiError(502) when the gateway fails. */
export async function sendSms(phone: string, message: string): Promise<void> {
  if (config.sms.provider === 'console') {
    // Development only (blocked in production by assertKycConfig).
    console.log(`[SMS to ${maskPhone(phone)}] ${message}`);
    return;
  }

  // Afro Message: POST /api/send with a Bearer token. Confirm the field names against their current docs when you go live.
  let res: Response;
  try {
    res = await fetch('https://api.afromessage.com/api/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.sms.afroToken}` },
      body: JSON.stringify({
        from: config.sms.afroIdentifier || undefined,
        sender: config.sms.afroSender || undefined,
        to: toInternational(phone),
        message,
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new ApiError(502, 'We could not send the SMS right now. Try again in a minute.');
  }
  const data = (await res.json().catch(() => ({}))) as { acknowledge?: string };
  if (!res.ok || data.acknowledge !== 'success') {
    console.error('SMS gateway refused the message', res.status, data);
    throw new ApiError(502, 'We could not send the SMS right now. Try again in a minute.');
  }
}
