import type { Request, Response as ExpressResponse } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { getRates } from '../services/settings';
import { ApiError, asyncHandler } from '../utils/http';

const bodySchema = z.object({
  lang: z.enum(['en', 'am']).default('en'),
  messages: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().trim().min(1).max(1000) }))
    .min(1)
    .max(12),
});

/** What the assistant may say about the platform. Money rules come from the real config, never from the model. */
function systemPrompt(lang: 'en' | 'am', rates: { sellerCommissionRate: number; buyerFeeRate: number }): string {
  const rate = Math.round(rates.sellerCommissionRate * 1000) / 10;
  return [
    'You are the Truth Market assistant. Truth Market is an Ethiopian marketplace where people buy and sell social media accounts/channels (Telegram, TikTok, YouTube, Instagram, Facebook) and websites/web apps, priced in Ethiopian Birr (ETB).',
    `Facts you may state: the platform keeps a ${rate}% commission from the seller's proceeds (the seller receives the rest of the listed price); the buyer also pays a ${Math.round(rates.buyerFeeRate * 1000) / 10}% service fee on top of the listed price (but for listings under 1,000 ETB the buyer fee is a flat 100 ETB instead; e.g. a 150 ETB listing costs the buyer 250 ETB; the seller's 10% commission is unchanged). Buyers pay through Chapa and the money is held in escrow. After the seller reports the handover the buyer has ${config.inspectionMs / 3_600_000} hours to inspect and may open a dispute; with no dispute the seller's share is released. Sellers must pass a National ID + phone-number + SMS-code check before they can list or withdraw. Withdrawals are paid out by the Truth Market team after a check.`,
    'Rules: be short and practical. Never ask for passwords, OTP codes, full National ID numbers or card details, and tell users never to share them. You cannot see orders, balances or accounts and cannot change anything; for a specific order or payment problem tell the user to open the order page or contact support. Do not give legal or financial advice. Remind users that platforms may forbid selling accounts, so they should check each platform\'s rules. If you do not know something, say so.',
    lang === 'am' ? 'Reply in Amharic (አማርኛ) unless the user writes in English.' : 'Reply in English unless the user writes in Amharic.',
  ].join('\n');
}

/** POST /api/assistant { lang, messages } -> { reply }. The Anthropic key never leaves the server. */
export const chat = asyncHandler(async (req: Request, res: ExpressResponse) => {
  if (!config.assistant.apiKey) throw new ApiError(503, 'The assistant is not switched on yet.');
  const { lang, messages } = bodySchema.parse(req.body);
  // The API needs the conversation to start with a user turn.
  const turns = messages[0].role === 'user' ? messages : messages.slice(1);
  if (turns.length === 0) throw new ApiError(400, 'Invalid conversation');

  let r: Response;
  try {
    r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: AbortSignal.timeout(25_000),
      headers: { 'content-type': 'application/json', 'x-api-key': config.assistant.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: config.assistant.model, max_tokens: config.assistant.maxOutputTokens, system: systemPrompt(lang, await getRates()), messages: turns }),
    });
  } catch (e) {
    console.error('Assistant request failed', (e as Error).message);
    throw new ApiError(502, 'The assistant could not be reached. Please try again.');
  }
  const data = (await r.json().catch(() => ({}))) as { content?: { type: string; text?: string }[] };
  if (!r.ok) {
    console.error('Assistant provider error', r.status);
    throw new ApiError(502, 'The assistant is unavailable right now.');
  }
  const reply = (data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('').trim();
  if (!reply) throw new ApiError(502, 'The assistant gave no answer. Please try again.');
  res.json({ reply });
});
