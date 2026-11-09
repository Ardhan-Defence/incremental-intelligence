export type TargetKind = 'ip' | 'domain' | 'email' | 'phone' | 'mastodon-profile' | 'telegram-channel' | 'username';

export interface ClassifiedTarget {
  kind: TargetKind;
  normalized: string;
  /** Extra bits the classifier already worked out so handlers don't re-parse
   * (e.g. a Mastodon URL's account handle + instance). */
  extra?: Record<string, string>;
}

export type ClaimConfidence = 'confirmed' | 'reported' | 'unavailable';

/** One fact in the profile, tagged with where it came from and how sure we
 * are — this is the thing a raw per-source JSON dump doesn't give you. */
export interface ProfileClaim {
  label: string;
  value: unknown;
  source: string;
  confidence: ClaimConfidence;
}

export interface ProfileSection {
  title: string;
  claims: ProfileClaim[];
  /** Set when this section's underlying source errored or wasn't reachable. */
  error?: string;
}

export interface Profile {
  target: string;
  classifiedAs: TargetKind;
  generatedAt: string;
  sections: ProfileSection[];
  /**
   * Explicit, named list of what this profile does NOT cover for this
   * target kind — e.g. "account/identity linkage for phone numbers needs a
   * paid lookup API, not configured" or "username → cross-platform account
   * discovery needs the Maigret enrichment runner, not yet built". This
   * exists so a gap is a visible field, not a silent omission.
   */
  gaps: string[];
}
