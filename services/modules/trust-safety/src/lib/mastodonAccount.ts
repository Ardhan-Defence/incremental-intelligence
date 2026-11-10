import { fetchJson } from './http.js';

const HTML_ENTITIES: Record<string, string> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'",
};

function stripHtml(html: string): string {
  const withoutTags = html.replace(/<[^>]+>/g, '').trim();
  return withoutTags.replace(/&(amp|lt|gt|quot|#39|apos);/g, (m) => HTML_ENTITIES[m] ?? m);
}

export interface MastodonAccountProfile {
  found: boolean;
  acct?: string;
  display_name?: string;
  followers_count?: number;
  following_count?: number;
  statuses_count?: number;
  created_at?: string;
  note?: string;
  url?: string;
  recent_posts?: Array<{ content_text: string; created_at: string; url: string }>;
}

/**
 * Account lookup + recent public posts. Lives here rather than in
 * intel-core: it's a trust-safety-specific enrichment call (profile
 * synthesis), not a generic registered source another module would
 * necessarily want — unlike the hashtag timeline (intel-core's
 * social-mastodon), which is genuinely foundation-level. Both endpoints are
 * public/keyless on a standard Mastodon instance.
 */
export async function lookupMastodonAccount(acct: string, instance: string): Promise<MastodonAccountProfile> {
  const base = instance.startsWith('http') ? instance : `https://${instance}`;
  const account = await fetchJson<any>(`${base}/api/v1/accounts/lookup?acct=${encodeURIComponent(acct)}`, { timeoutMs: 8000 });
  if (!account) return { found: false };

  const statuses = await fetchJson<any[]>(`${base}/api/v1/accounts/${account.id}/statuses?limit=10`, { timeoutMs: 8000 });

  return {
    found: true,
    acct: account.acct,
    display_name: account.display_name,
    followers_count: account.followers_count,
    following_count: account.following_count,
    statuses_count: account.statuses_count,
    created_at: account.created_at,
    note: stripHtml(account.note || ''),
    url: account.url,
    recent_posts: (statuses || []).slice(0, 10).map((s) => ({
      content_text: stripHtml(s.content || ''),
      created_at: s.created_at,
      url: s.url,
    })),
  };
}
