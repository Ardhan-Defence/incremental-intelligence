import { classify } from './classify.js';
import type { Profile, ProfileSection } from './types.js';
import { whoisSource } from '../sources/osint/whois.js';
import { certsSource } from '../sources/osint/certs.js';
import { dnsSource } from '../sources/osint/dns.js';
import { bgpSource } from '../sources/osint/bgp.js';
import { threatIntelSource } from '../sources/threatIntel.js';
import { telegramSource } from '../sources/social/telegram.js';
import { lookupMastodonAccount } from '../sources/social/mastodon.js';
import { parsePhoneNumberFromString } from 'libphonenumber-js';

async function ipProfile(ip: string): Promise<{ sections: ProfileSection[]; gaps: string[] }> {
  const [bgp, threat] = await Promise.all([bgpSource.fetch({ query: ip }), threatIntelSource.fetch({ query: ip })]);
  const bgpPayload = bgp.items[0]?.payload as any;
  const threatPayload = threat.items.find((i) => i.type === 'ip-domain-reputation')?.payload as any;

  const sections: ProfileSection[] = [
    {
      title: 'Network ownership (BGP/ASN)',
      error: bgp.error,
      claims: bgpPayload?.ip
        ? [
            { label: 'ASN', value: bgpPayload.ip.rir_allocation?.asn ?? bgpPayload.ip.prefixes?.[0]?.asn?.asn, source: 'bgpview.io', confidence: 'confirmed' },
            { label: 'Network owner', value: bgpPayload.ip.prefixes?.[0]?.asn?.name, source: 'bgpview.io', confidence: 'confirmed' },
            { label: 'Country', value: bgpPayload.ip.rir_allocation?.country_code, source: 'bgpview.io', confidence: 'confirmed' },
          ]
        : [],
    },
    {
      title: 'Threat reputation',
      error: threat.error,
      claims: [
        { label: 'Tor exit node', value: threatPayload?.tor_exit_node ?? 'unknown', source: 'tor-project', confidence: threatPayload?.tor_exit_node != null ? 'confirmed' : 'unavailable' },
        { label: 'Threat-intel pulse mentions', value: threatPayload?.pulse_count ?? 0, source: 'alienvault-otx', confidence: 'reported' },
      ],
    },
  ];

  return { sections, gaps: ['Geolocation is not included — BGP gives network-owner country, not physical location.'] };
}

async function domainProfile(domain: string): Promise<{ sections: ProfileSection[]; gaps: string[] }> {
  const [whois, certs, dns, threat] = await Promise.all([
    whoisSource.fetch({ domain }),
    certsSource.fetch({ domain }),
    dnsSource.fetch({ domain }),
    threatIntelSource.fetch({ query: domain }),
  ]);
  const whoisPayload = whois.items[0]?.payload as any;
  const certsPayload = certs.items[0]?.payload as any;
  const dnsPayload = dns.items[0]?.payload as any;
  const threatPayload = threat.items.find((i) => i.type === 'ip-domain-reputation')?.payload as any;

  const sections: ProfileSection[] = [
    {
      title: 'Registration',
      error: whois.error,
      claims: whoisPayload
        ? [
            { label: 'Registered', value: whoisPayload.registration ?? 'unknown', source: 'rdap', confidence: whoisPayload.registration ? 'confirmed' : 'unavailable' },
            { label: 'Expires', value: whoisPayload.expiration ?? 'unknown', source: 'rdap', confidence: whoisPayload.expiration ? 'confirmed' : 'unavailable' },
            { label: 'HTTP security grade', value: whoisPayload.http_security_score?.grade ?? 'unavailable', source: 'direct HTTP probe', confidence: whoisPayload.http_security_score ? 'confirmed' : 'unavailable' },
          ]
        : [],
    },
    {
      title: 'Infrastructure footprint',
      error: certs.error || dns.error,
      claims: [
        { label: 'A records', value: dnsPayload?.records?.A?.map((r: any) => r.data) ?? [], source: 'google-doh', confidence: 'confirmed' },
        { label: 'Subdomains (via certificate transparency)', value: certsPayload?.subdomains ?? [], source: 'crt.sh', confidence: certs.error ? 'unavailable' : 'confirmed' },
      ],
    },
    {
      title: 'Threat reputation',
      error: threat.error,
      claims: [{ label: 'Threat-intel pulse mentions', value: threatPayload?.pulse_count ?? 0, source: 'alienvault-otx', confidence: 'reported' }],
    },
  ];

  return {
    sections,
    gaps: [
      'Network/ASN ownership not included — would need to resolve the domain to an IP first and run the IP profile on it (not automated yet).',
      'No breach-database or dark-web-mention check — would need a service like HaveIBeenPwned configured.',
    ],
  };
}

async function phoneProfile(phoneInput: string): Promise<{ sections: ProfileSection[]; gaps: string[] }> {
  const phone = parsePhoneNumberFromString(phoneInput);
  const sections: ProfileSection[] = [
    {
      title: 'Number validation',
      claims: phone
        ? [
            { label: 'Valid', value: phone.isValid(), source: 'libphonenumber', confidence: 'confirmed' },
            { label: 'Country', value: phone.country ?? 'unknown', source: 'libphonenumber', confidence: 'confirmed' },
            { label: 'Line type', value: phone.getType() ?? 'unknown', source: 'libphonenumber', confidence: phone.getType() ? 'confirmed' : 'unavailable' },
            { label: 'International format', value: phone.formatInternational(), source: 'libphonenumber', confidence: 'confirmed' },
          ]
        : [{ label: 'Valid', value: false, source: 'libphonenumber', confidence: 'confirmed' }],
    },
  ];

  return {
    sections,
    gaps: [
      'Carrier name and account/identity linkage are not included — that needs a paid lookup API (e.g. Twilio Lookup, Numverify), not currently configured.',
      'Deliberately not attempting account-enumeration (checking which platforms this number is registered on via auth/reset endpoints) — flagged as an ethical/legal risk in the enrichment-runners review and intentionally excluded.',
    ],
  };
}

async function mastodonProfile(acct: string, instance: string): Promise<{ sections: ProfileSection[]; gaps: string[] }> {
  const profile = await lookupMastodonAccount(acct, instance);
  const sections: ProfileSection[] = [
    {
      title: 'Social profile (Mastodon)',
      error: profile.found ? undefined : 'Account not found or instance unreachable',
      claims: profile.found
        ? [
            { label: 'Display name', value: profile.display_name, source: instance, confidence: 'confirmed' },
            { label: 'Bio', value: profile.note, source: instance, confidence: 'confirmed' },
            { label: 'Followers', value: profile.followers_count, source: instance, confidence: 'confirmed' },
            { label: 'Account created', value: profile.created_at, source: instance, confidence: 'confirmed' },
            { label: 'Recent posts', value: profile.recent_posts, source: instance, confidence: 'confirmed' },
          ]
        : [],
    },
  ];

  return {
    sections,
    gaps: ['Cross-platform account discovery (does this person use other platforms?) needs the Maigret enrichment runner — not yet built.'],
  };
}

async function telegramProfile(channel: string): Promise<{ sections: ProfileSection[]; gaps: string[] }> {
  const result = await telegramSource.fetch({ channel });
  const sections: ProfileSection[] = [
    {
      title: 'Telegram channel activity',
      error: result.error,
      claims: result.items.slice(0, 10).map((item) => ({
        label: 'Recent message',
        value: (item.payload as any).text,
        source: 'telegram-preview',
        confidence: 'reported',
      })),
    },
  ];

  return {
    sections,
    gaps: [
      'Legal basis for this source is unverified (see social-telegram source note) — scraped from the unofficial public preview, not an official API.',
      'Channel owner identity is not resolvable from the public preview alone.',
    ],
  };
}

export async function investigate(rawTarget: string): Promise<Profile> {
  const classified = classify(rawTarget);
  const now = new Date().toISOString();

  let result: { sections: ProfileSection[]; gaps: string[] };

  switch (classified.kind) {
    case 'ip':
      result = await ipProfile(classified.normalized);
      break;
    case 'domain':
    case 'email': // email: profile the domain half — see gap note below
      result = await domainProfile(classified.kind === 'email' ? classified.normalized.split('@')[1] : classified.normalized);
      if (classified.kind === 'email') {
        result.gaps.unshift('Input was an email address — profiled its domain only. Mailbox-level checks (validity, breach exposure) are not implemented.');
      }
      break;
    case 'phone':
      result = await phoneProfile(classified.normalized);
      break;
    case 'mastodon-profile':
      result = await mastodonProfile(classified.extra!.acct, classified.extra!.instance);
      break;
    case 'telegram-channel':
      result = await telegramProfile(classified.extra!.channel);
      break;
    case 'username':
    default:
      result = {
        sections: [],
        gaps: [
          'Bare username given with no platform — cross-platform account discovery needs the Maigret enrichment runner, which is not yet built.',
          'In the meantime, a platform-specific link (e.g. a t.me/<channel> or https://<instance>/@<handle> URL) will return real data.',
        ],
      };
  }

  return {
    target: rawTarget,
    classifiedAs: classified.kind,
    generatedAt: now,
    sections: result.sections,
    gaps: result.gaps,
  };
}
