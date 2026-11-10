import { fetchSource } from '../lib/foundationClient.js';
import { allAssets, appendAsset } from './assetLog.js';
import { lookupEntity, resolveRecords, type EntityRecord } from '../lib/entityResolutionClient.js';

interface FlightPayload {
  callsign: string;
  registration: string;
  icao24: string;
  airline_code: string;
}

export interface AssetCorrelation {
  queried: { registration?: string; icao24?: string };
  found_live: boolean;
  entity_id: string | null;
  known_registrations: string[];
  known_operators: string[];
  note?: string;
}

/**
 * Given a tail number or icao24, finds its current live sighting (if
 * airborne right now — this only sees what's currently broadcasting, not
 * a historical flight database), logs it, resolves it against everything
 * logged before, and reads back what identifiers the graph has merged
 * onto the same Entity. This is the honest scope: correlation across
 * identifiers already present in the ADS-B feed (registration, icao24,
 * operator/callsign prefix) — not an owner/operator name lookup, which
 * would need a licensed civil-aviation registry this module does not
 * have access to yet (see README).
 */
export async function correlateAsset(query: { registration?: string; icao24?: string }): Promise<AssetCorrelation> {
  const result = await fetchSource<FlightPayload>('flights');
  const items = (result.error ? [] : result.items).filter((i) => i.type === 'flight');

  const needleReg = query.registration?.trim().toUpperCase();
  const needleIcao = query.icao24?.trim().toLowerCase();

  const live = items.find((i) => {
    const payload = i.payload as FlightPayload;
    if (needleReg && (payload.registration || '').toUpperCase() === needleReg) return true;
    if (needleIcao && (payload.icao24 || '').toLowerCase() === needleIcao) return true;
    return false;
  });

  if (live) {
    const payload = live.payload as FlightPayload;
    appendAsset({
      icao24: (payload.icao24 || '').toLowerCase(),
      registration: payload.registration || undefined,
      operator_code: payload.airline_code || undefined,
    });
  }

  const records: EntityRecord[] = allAssets().map((a) => ({
    unique_id: a.unique_id,
    icao24: a.icao24,
    registration: a.registration,
    operator_code: a.operator_code,
  }));

  if (records.length === 0) {
    return {
      queried: query,
      found_live: !!live,
      entity_id: null,
      known_registrations: [],
      known_operators: [],
      note: live ? undefined : 'Not currently airborne in the live feed, and nothing logged for it yet — no correlation to run.',
    };
  }

  await resolveRecords(records, true);

  const lookupValue = needleIcao || (live ? ((live.payload as FlightPayload).icao24 || '').toLowerCase() : undefined) || needleReg;
  const lookupType: 'icao24' | 'registration' = needleIcao || live ? 'icao24' : 'registration';
  if (!lookupValue) {
    return { queried: query, found_live: false, entity_id: null, known_registrations: [], known_operators: [] };
  }

  const entity = await lookupEntity(lookupValue, lookupType);
  if (!entity?.found) {
    return { queried: query, found_live: !!live, entity_id: null, known_registrations: [], known_operators: [] };
  }

  return {
    queried: query,
    found_live: !!live,
    entity_id: entity.entity_id,
    known_registrations: entity.identifiers.filter((i) => i.type === 'registration').map((i) => i.value),
    known_operators: entity.identifiers.filter((i) => i.type === 'operator_code').map((i) => i.value),
  };
}
