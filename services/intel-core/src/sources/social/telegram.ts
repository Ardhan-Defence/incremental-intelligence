import type { IntelItem, SourceDefinition, SourceResult } from '../../types.js';
import { fetchText } from '../../lib/http.js';

interface TelegramPostPayload {
  text: string;
  views: number | null;
  posted_at: string | null;
}

/**
 * REWORK NEEDED before relying on this — legal footing is unverified, not
 * just the usual "rate limit this" caveat.
 *
 * There is no official Telegram API for reading an arbitrary public
 * channel's message history as a third party. The only documented route is
 * scraping the web preview at t.me/s/<channel> — plain server-rendered HTML
 * that Telegram serves to channels that have opted into a public preview.
 *
 * What's actually known, from what I found researching this (not verified
 * against Telegram's current ToS directly):
 *   - The preview only exists for channels that enabled it; it's not a
 *     bypass of anything private.
 *   - It's ordinary HTTP/HTML, not Telegram's Bot API or MTProto — so
 *     Telegram's API Terms may not literally apply, but that's an
 *     interpretation from a third-party README, not a ruling.
 *   - Telegram's Bot API itself cannot read arbitrary public channel
 *     history unless your bot is an admin of that channel — so there's no
 *     "do it properly with a token" alternative here.
 *
 * This implementation works mechanically (regex-extracts message blocks
 * from the preview HTML, same style as the RSS parsing elsewhere in this
 * service) but ships in the 'rework' tier on legal grounds, not technical
 * ones. Before using this against any channel in a product: read Telegram's
 * current Terms of Service yourself, and don't point it at channels en
 * masse — this is scoped to specific, deliberately-chosen public channels
 * (e.g. ones relevant to a named investigation), not bulk harvesting.
 */
const TELEGRAM_TODO = 'unverified-legal-basis' as const;

function extractMessages(html: string): Array<{ id: string; text: string; views: number | null; posted_at: string | null }> {
  const messages: Array<{ id: string; text: string; views: number | null; posted_at: string | null }> = [];
  const blockRegex = /<div class="tgme_widget_message[^"]*"\s+data-post="([^"]+)"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/g;
  let match: RegExpExecArray | null;
  while ((match = blockRegex.exec(html)) !== null) {
    const block = match[0];
    const dataPost = match[1]; // "<channel>/<message_id>"
    const textMatch = block.match(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    const viewsMatch = block.match(/<span class="tgme_widget_message_views">([^<]+)<\/span>/);
    const timeMatch = block.match(/<time[^>]*datetime="([^"]+)"/);
    messages.push({
      id: dataPost,
      text: (textMatch?.[1] || '').replace(/<[^>]+>/g, '').trim(),
      views: viewsMatch ? parseInt(viewsMatch[1].replace(/[^\d]/g, ''), 10) || null : null,
      posted_at: timeMatch?.[1] ?? null,
    });
  }
  return messages;
}

async function fetchTelegramChannel(params: Record<string, string> = {}): Promise<SourceResult<TelegramPostPayload>> {
  const channel = params.channel;
  const now = new Date().toISOString();
  if (!channel) {
    return { source: 'telegram-preview', fetchedAt: now, items: [], error: 'Missing channel parameter' };
  }

  const html = await fetchText(`https://t.me/s/${encodeURIComponent(channel)}`, { timeoutMs: 8000 });
  if (!html) {
    return { source: 'telegram-preview', fetchedAt: now, items: [], error: 'Channel preview unavailable (not public, no preview enabled, or unreachable)' };
  }

  const items: IntelItem<TelegramPostPayload>[] = extractMessages(html).map((m) => ({
    type: 'social-post',
    id: `telegram-${m.id}`,
    timestamp: m.posted_at ?? now,
    source: 'telegram-preview',
    confidence: 'live',
    payload: { text: m.text, views: m.views, posted_at: m.posted_at },
  }));

  return { source: 'telegram-preview', fetchedAt: now, items, error: items.length === 0 ? 'No messages parsed (preview HTML structure may have changed)' : undefined };
}

export const telegramSource: SourceDefinition = {
  name: 'social-telegram',
  tier: 'rework',
  reworkNote: `Scrapes the unofficial t.me/s/ public preview — ${TELEGRAM_TODO}: no official API for reading public channel history as a third party. Read Telegram's current ToS before using in a product; scope to specific named channels, not bulk harvesting.`,
  fetch: fetchTelegramChannel,
};
