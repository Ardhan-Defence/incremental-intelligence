/**
 * Normalized envelope every source module returns. Downstream TG-facing
 * products consume this shape regardless of which upstream API produced it —
 * that decoupling is the entire point of extracting this service.
 */
export interface IntelItem<P = Record<string, unknown>> {
  type: string;
  id: string;
  lat?: number;
  lng?: number;
  timestamp: string;
  source: string;
  /** 'live' = fetched just now from an external API, 'static' = curated reference
   * data with no live upstream, 'derived' = computed/aggregated from other items. */
  confidence: 'live' | 'static' | 'derived';
  payload: P;
}

export interface SourceResult<P = Record<string, unknown>> {
  source: string;
  fetchedAt: string;
  items: IntelItem<P>[];
  /** Set when the upstream call failed or was skipped; items may still be
   * partially populated from a fallback. */
  error?: string;
}

export type SourceFn = (params?: Record<string, string>, req?: Request) => Promise<SourceResult>;

export interface SourceDefinition {
  name: string;
  tier: 'keep' | 'rework';
  /** One-line note on what "rework" means for this source, if applicable. */
  reworkNote?: string;
  // Each module's fetch returns SourceResult<ItsOwnPayloadType>; callers only
  // ever consume the result as JSON, so erasing to `any` here is the
  // pragmatic choice over forcing every module to cast its payload.
  fetch: (params?: Record<string, string>, req?: Request) => Promise<SourceResult<any>>;
}
