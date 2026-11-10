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

export function stripHtml(html: string): string {
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
