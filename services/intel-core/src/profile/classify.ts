import { isIP } from 'node:net';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import type { ClassifiedTarget } from './types.js';

const DOMAIN_RE = /^[a-zA-Z0-9][a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Classification order matters — checked most-unambiguous-first so a string
 * that happens to look like two things lands on the more specific read
 * (e.g. a t.me URL is a URL before it's "a domain", a bare digit string is
 * tried as a phone number before falling through to "username").
 */
export function classify(raw: string): ClassifiedTarget {
  const input = raw.trim();

  if (isIP(input)) {
    return { kind: 'ip', normalized: input };
  }

  // URL forms — pull out the handler-specific bits now so investigate.ts
  // doesn't need to re-parse.
  if (/^https?:\/\//i.test(input) || /^t\.me\//i.test(input)) {
    try {
      const url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);

      if (url.hostname === 't.me') {
        const channel = url.pathname.replace(/^\/s\//, '/').replace(/^\//, '').split('/')[0];
        if (channel) return { kind: 'telegram-channel', normalized: input, extra: { channel } };
      }

      // Mastodon profile URL shape: https://<instance>/@<user>
      const mastodonMatch = url.pathname.match(/^\/@([^/@]+)(?:@([^/]+))?$/);
      if (mastodonMatch) {
        return {
          kind: 'mastodon-profile',
          normalized: input,
          extra: { acct: mastodonMatch[1], instance: mastodonMatch[2] ?? url.hostname },
        };
      }

      // Any other URL: fall back to treating its hostname as a domain target.
      if (DOMAIN_RE.test(url.hostname)) {
        return { kind: 'domain', normalized: url.hostname };
      }
    } catch {
      // fall through to other checks if URL parsing failed
    }
  }

  if (EMAIL_RE.test(input)) {
    return { kind: 'email', normalized: input };
  }

  // Try phone before domain/username — a string of digits/punctuation isn't
  // going to accidentally match the domain or username shape below anyway,
  // but a bare "+<digits>" could be misread as a weird username otherwise.
  const phone = parsePhoneNumberFromString(input, 'US'); // default region only matters for numbers without a country code
  if (phone?.isValid()) {
    return { kind: 'phone', normalized: phone.number };
  }

  if (DOMAIN_RE.test(input)) {
    return { kind: 'domain', normalized: input };
  }

  // A @handle or @handle@instance Mastodon-style reference without a URL.
  const bareMastodon = input.match(/^@?([^/@]+)@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})$/);
  if (bareMastodon) {
    return { kind: 'mastodon-profile', normalized: input, extra: { acct: bareMastodon[1], instance: bareMastodon[2] } };
  }

  return { kind: 'username', normalized: input.replace(/^@/, '') };
}
