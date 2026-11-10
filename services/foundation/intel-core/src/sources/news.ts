import type { IntelItem, SourceDefinition, SourceResult } from '../types.js';
import { fetchText, settleAll } from '../lib/http.js';

interface NewsPayload {
  title: string;
  link: string;
  published: string;
  risk_score: number;
  geocode_method: 'keyword-dictionary' | 'none';
}

interface LiveStreamPayload {
  name: string;
  url: string;
  embed_allowed: boolean;
  category: string;
}

/**
 * REWORK NEEDED before a product depends on this: coordinates come from a
 * hardcoded keyword → lat/lng dictionary (ported from the original
 * news/gdelt routes), not a real geocoder. It silently mis-locates any
 * article whose text doesn't contain one of these exact keywords, and
 * country-level keywords collapse every matching story onto one point.
 * Replace with a real NER + geocoding step (e.g. a hosted geocoding API, or
 * a local gazetteer lookup) before this feeds anything customer-facing.
 */
const GEOCODE_TODO = 'keyword-dictionary' as const;

const KEYWORD_COORDS: Record<string, [number, number]> = {
  ukraine: [49.487, 31.272], kyiv: [50.45, 30.523], russia: [61.524, 105.318], moscow: [55.755, 37.617],
  israel: [31.046, 34.851], gaza: [31.416, 34.333], iran: [32.427, 53.688], lebanon: [33.854, 35.862],
  syria: [34.802, 38.996], yemen: [15.552, 48.516], china: [35.861, 104.195], taiwan: [23.697, 120.96],
  'north korea': [40.339, 127.51], 'south korea': [35.907, 127.766], japan: [36.204, 138.252],
  afghanistan: [33.939, 67.709], pakistan: [30.375, 69.345], india: [20.593, 78.962], sudan: [12.862, 30.217],
  nigeria: [9.082, 8.675], egypt: [26.82, 30.802], libya: [26.335, 17.228], somalia: [5.152, 46.199],
  venezuela: [7.119, -66.589], mexico: [23.634, -102.552], 'united states': [38.907, -77.036],
  'south china sea': [15.0, 115.0], 'red sea': [20.0, 38.5], 'strait of hormuz': [26.6, 56.3],
  bulgaria: [42.698, 25.485], sofia: [42.698, 25.485], greece: [39.074, 21.824], serbia: [44.016, 21.005],
  romania: [45.943, 24.967], turkey: [39.0, 35.0], germany: [51.166, 10.452], france: [46.228, 2.214],
  uk: [55.378, -3.436],
};

const RISK_KEYWORDS = ['war', 'missile', 'strike', 'attack', 'crisis', 'tension', 'military', 'conflict', 'defense', 'clash', 'nuclear', 'invasion', 'bomb', 'drone', 'weapon', 'sanctions', 'ceasefire', 'escalation'];

const FEEDS: Record<string, string> = {
  BBC: 'https://feeds.bbci.co.uk/news/world/rss.xml',
  AlJazeera: 'https://www.aljazeera.com/xml/rss/all.xml',
  NPR: 'https://feeds.npr.org/1004/rss.xml',
  NYTimes: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml',
  NHK: 'https://www3.nhk.or.jp/nhkworld/rss/world.xml',
};

const RSS_HEADERS = { 'User-Agent': 'IntelCore/0.1', Accept: 'application/rss+xml, application/xml, text/xml, */*' };

// A curated, non-exhaustive sample — the original had ~20 channels; trimmed
// here to a representative set. Expand freely, this list is just metadata,
// no aggregation logic involved.
const LIVE_FEEDS: Array<{ id: string; name: string; url: string; embed_allowed: boolean; category: string }> = [
  { id: 'skynews', name: 'Sky News', url: 'https://www.youtube.com/embed/live_stream?channel=UCoMdktPbSTixAyNGwb-UYkQ', embed_allowed: true, category: 'mainstream' },
  { id: 'aljazeera', name: 'Al Jazeera EN', url: 'https://www.youtube.com/embed/live_stream?channel=UCNye-wNBqNL5ZzHSJj3l8Bg', embed_allowed: true, category: 'mainstream' },
  { id: 'france24en', name: 'France 24 EN', url: 'https://www.youtube.com/embed/live_stream?channel=UCQfwfsi5VrQ8yKZ-UWmAEFg', embed_allowed: true, category: 'mainstream' },
  { id: 'nhkworld', name: 'NHK World', url: 'https://www.youtube.com/embed/live_stream?channel=UCSPEjw8F2nQDtmUKPFNF7_A', embed_allowed: true, category: 'mainstream' },
];

function scoreRisk(text: string): number {
  const lower = text.toLowerCase();
  let score = 1;
  for (const kw of RISK_KEYWORDS) if (lower.includes(kw)) score += 2;
  return Math.min(10, score);
}

function findCoords(text: string): [number, number] | null {
  const lower = text.toLowerCase();
  for (const [keyword, coords] of Object.entries(KEYWORD_COORDS)) {
    if (lower.includes(keyword)) return coords;
  }
  return null;
}

function parseRssItems(xml: string): Array<{ title: string; link: string; pubDate: string; description: string }> {
  const items: Array<{ title: string; link: string; pubDate: string; description: string }> = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;
  while ((match = itemRegex.exec(xml)) !== null) {
    const itemXml = match[1];
    const getTag = (tag: string) => {
      const m = itemXml.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
      return (m?.[1] || m?.[2] || '').trim();
    };
    items.push({
      title: getTag('title').replace(/<[^>]+>/g, ''),
      link: getTag('link'),
      pubDate: getTag('pubDate'),
      description: getTag('description').replace(/<[^>]+>/g, '').substring(0, 200),
    });
  }
  return items;
}

async function fetchNews(): Promise<SourceResult<NewsPayload | LiveStreamPayload>> {
  const now = new Date().toISOString();

  const feedResults = await settleAll(
    Object.entries(FEEDS).map(async ([source, url]) => {
      const xml = await fetchText(url, { timeoutMs: 8000, headers: RSS_HEADERS });
      if (!xml) return [];
      return parseRssItems(xml).slice(0, 5).map((item) => ({ ...item, source }));
    }),
  );

  const newsItems: IntelItem<NewsPayload>[] = feedResults.flat().map((article, i) => {
    const coords = findCoords(article.title + ' ' + article.description);
    return {
      type: 'news-article',
      id: `news-${article.source}-${i}`,
      lat: coords?.[0],
      lng: coords?.[1],
      timestamp: article.pubDate || now,
      source: article.source,
      confidence: 'live',
      payload: {
        title: article.title,
        link: article.link,
        published: article.pubDate,
        risk_score: scoreRisk(article.title + ' ' + article.description),
        geocode_method: coords ? GEOCODE_TODO : 'none',
      },
    };
  });

  const liveStreamItems: IntelItem<LiveStreamPayload>[] = LIVE_FEEDS.map((f) => ({
    type: 'live-stream',
    id: f.id,
    timestamp: now,
    source: 'curated-static',
    confidence: 'static',
    payload: { name: f.name, url: f.url, embed_allowed: f.embed_allowed, category: f.category },
  }));

  return { source: 'rss-aggregate', fetchedAt: now, items: [...newsItems, ...liveStreamItems] };
}

export const newsSource: SourceDefinition = {
  name: 'news',
  tier: 'rework',
  reworkNote: 'Geo-mapping uses a hardcoded keyword dictionary, not a real geocoder (see GEOCODE_TODO) — replace before relying on article coordinates.',
  fetch: fetchNews,
};
