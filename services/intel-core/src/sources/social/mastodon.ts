import type { IntelItem, SourceDefinition, SourceResult } from '../../types.js';
import { fetchJson } from '../../lib/http.js';

interface MastodonPostPayload {
  content_text: string;
  url: string;
  account: string;
  instance: string;
  reblogs_count: number;
  favourites_count: number;
}

// Mastodon's hashtag timeline is genuinely free and keyless on most
// instances (unlike the federated/public timeline, which many large
// instances — including mastodon.social — gate behind auth). This is the
// one social-media source in this module with no legal ambiguity: it's a
// documented, official API endpoint, not a scrape.
//
// Single-instance by default. Real fediverse monitoring needs to query
// several instances and merge results — mastodon.social alone misses a lot
// of the fediverse. Left as a single default for now; extend INSTANCES to
// broaden coverage.
const INSTANCES = ['https://mastodon.social'];

const HTML_ENTITIES: Record<string, string> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'",
};

function stripHtml(html: string): string {
  const withoutTags = html.replace(/<[^>]+>/g, '').trim();
  return withoutTags.replace(/&(amp|lt|gt|quot|#39|apos);/g, (m) => HTML_ENTITIES[m] ?? m);
}

async function fetchMastodonHashtag(params: Record<string, string> = {}): Promise<SourceResult<MastodonPostPayload>> {
  const hashtag = params.hashtag;
  const now = new Date().toISOString();
  if (!hashtag) {
    return { source: 'mastodon', fetchedAt: now, items: [], error: 'Missing hashtag parameter' };
  }

  const items: IntelItem<MastodonPostPayload>[] = [];
  for (const instance of INSTANCES) {
    const posts = await fetchJson<any[]>(`${instance}/api/v1/timelines/tag/${encodeURIComponent(hashtag)}?limit=40`, { timeoutMs: 8000 });
    if (!posts) continue;
    for (const post of posts) {
      items.push({
        type: 'social-post',
        id: `mastodon-${post.id}`,
        timestamp: post.created_at ?? now,
        source: 'mastodon',
        confidence: 'live',
        payload: {
          content_text: stripHtml(post.content || ''),
          url: post.url,
          account: post.account?.acct ?? 'unknown',
          instance,
          reblogs_count: post.reblogs_count ?? 0,
          favourites_count: post.favourites_count ?? 0,
        },
      });
    }
  }

  return { source: 'mastodon', fetchedAt: now, items, error: items.length === 0 ? 'No posts found for hashtag (or instance unreachable)' : undefined };
}

export const mastodonSource: SourceDefinition = {
  name: 'social-mastodon',
  tier: 'keep',
  fetch: fetchMastodonHashtag,
};

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
 * Account lookup + recent public posts, used by the profile synthesis
 * layer (src/profile/). Both endpoints are public/keyless on a standard
 * Mastodon instance — `/accounts/lookup` for exact-handle resolution,
 * `/accounts/:id/statuses` for their public timeline.
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
