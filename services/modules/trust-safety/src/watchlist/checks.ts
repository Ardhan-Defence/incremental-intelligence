import type { CheckResult, WatchlistKind } from './types.js';
import { fetchSource } from '../lib/foundationClient.js';

/**
 * One check function per watchlist kind. Each returns a "fingerprint": a
 * flat list of opaque IDs representing the current state. The engine diffs
 * this against the previous run's fingerprint — any ID that's new triggers
 * an alert. This is intentionally dumb (set difference, not semantic
 * understanding of what changed) but it's enough to turn "go look this up
 * again" into "tell me when something's actually different."
 *
 * Each check calls the foundation (intel-core) over HTTP via fetchSource —
 * this module never imports foundation source code directly.
 */
async function checkDomain(target: string): Promise<CheckResult> {
  const [certResult, whoisResult] = await Promise.all([
    fetchSource('osint-certs', { domain: target }),
    fetchSource('osint-whois', { domain: target }),
  ]);

  // A failed upstream must not be allowed to masquerade as "zero
  // subdomains" — that would overwrite a real baseline with an empty one
  // and false-alert on every subdomain the next time the check succeeds.
  if (certResult.error) {
    return { fingerprint: [], detail: {}, error: `certs lookup failed: ${certResult.error}` };
  }

  const subdomains: string[] = (certResult.items[0]?.payload as any)?.subdomains ?? [];
  const whoisPayload = whoisResult.items[0]?.payload as any;

  return {
    // Subdomains discovered via cert transparency are the main signal —
    // registration/expiry rarely change day to day, so they're carried as
    // detail, not fingerprinted (would otherwise never fire an alert).
    fingerprint: subdomains.map((s) => `subdomain:${s}`),
    detail: {
      subdomain_count: subdomains.length,
      registration: whoisPayload?.registration,
      expiration: whoisPayload?.expiration,
      http_security_grade: whoisPayload?.http_security_score?.grade,
      // whois failure is non-fatal: it only affects these detail fields
      // (left undefined above), not the certs-derived fingerprint, so it
      // must not block persisting a real fingerprint update.
      whois_error: whoisResult.error,
    },
  };
}

async function checkIp(target: string): Promise<CheckResult> {
  const result = await fetchSource('threat-intel', { query: target });
  if (result.error) {
    return { fingerprint: [], detail: {}, error: `threat-intel lookup failed: ${result.error}` };
  }

  const payload = result.items.find((i) => i.type === 'ip-domain-reputation')?.payload as any;

  const fingerprint: string[] = [];
  if (payload?.tor_exit_node) fingerprint.push('tor-exit-node');
  if (typeof payload?.pulse_count === 'number' && payload.pulse_count > 0) {
    // Bucket pulse count so the fingerprint only changes on meaningful jumps,
    // not every +1.
    fingerprint.push(`pulse-bucket:${Math.floor(payload.pulse_count / 5)}`);
  }

  return { fingerprint, detail: { tor_exit_node: payload?.tor_exit_node, pulse_count: payload?.pulse_count, reputation: payload?.reputation } };
}

async function checkMastodonHashtag(target: string): Promise<CheckResult> {
  const result = await fetchSource('social-mastodon', { hashtag: target });
  if (result.error) {
    return { fingerprint: [], detail: {}, error: `mastodon lookup failed: ${result.error}` };
  }
  return {
    fingerprint: result.items.map((i) => i.id),
    detail: { post_count: result.items.length },
  };
}

async function checkTelegramChannel(target: string): Promise<CheckResult> {
  const result = await fetchSource('social-telegram', { channel: target });
  if (result.error) {
    return { fingerprint: [], detail: {}, error: `telegram lookup failed: ${result.error}` };
  }
  return {
    fingerprint: result.items.map((i) => i.id),
    detail: { message_count: result.items.length },
  };
}

export const CHECKS: Record<WatchlistKind, (target: string) => Promise<CheckResult>> = {
  domain: checkDomain,
  ip: checkIp,
  'mastodon-hashtag': checkMastodonHashtag,
  'telegram-channel': checkTelegramChannel,
};

export const DEFAULT_INTERVAL_MS: Record<WatchlistKind, number> = {
  domain: 3_600_000, // subdomains/registration data don't change fast
  ip: 900_000, // reputation can shift quickly
  'mastodon-hashtag': 300_000,
  'telegram-channel': 300_000,
};
