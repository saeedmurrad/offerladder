import { CarPark, Hospital, Place, Places, School, Station } from './models';

/** One OpenStreetMap object as the Overpass API returns it. */
export interface OsmElement {
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

/** How far out each kind of place is looked for, in metres. */
export const SEARCH = {
  schools: 1600,
  carParks: 800,
  doctors: 1600,
  pharmacies: 1600,
  supermarkets: 1000,
  parks: 800,
  busStops: 400,
  stations: 10_000,
  hospitals: 15_000,
};

export function distanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = Math.PI / 180;
  const x = (lng2 - lng1) * rad * Math.cos(((lat1 + lat2) / 2) * rad);
  const y = (lat2 - lat1) * rad;
  return Math.sqrt(x * x + y * y) * 6_371_000;
}

/** The two Overpass queries: places within walking distance, and the few that can be much further away. */
export function placeQueries(lat: number, lng: number): { near: string; far: string } {
  const at = `${lat},${lng}`;
  const near =
    `[out:json][timeout:40];(` +
    `nwr(around:${SEARCH.schools},${at})[amenity~"^(school|doctors|pharmacy)$"];` +
    `nwr(around:${SEARCH.carParks},${at})[amenity=parking];` +
    `nwr(around:${SEARCH.supermarkets},${at})[shop=supermarket];` +
    `nwr(around:${SEARCH.parks},${at})[leisure=park][name];` +
    `node(around:${SEARCH.busStops},${at})[highway=bus_stop];` +
    `);out center tags 500;`;
  const far = `[out:json][timeout:40];(node(around:${SEARCH.stations},${at})[railway=station];nwr(around:${SEARCH.hospitals},${at})[amenity=hospital];);out center tags 80;`;
  return { near, far };
}

/** How the map records the kind of school, in plain words. Special and alternative-provision schools are not open to every local child. */
const SCHOOL_TYPES: Record<string, string> = {
  academy: 'academy',
  free: 'free school',
  community: 'community school',
  foundation: 'foundation school',
  voluntary_aided: 'voluntary aided',
  voluntary_controlled: 'voluntary controlled',
  independent: 'independent (fee-paying)',
  special: 'special school',
  alternative_provision: 'alternative provision',
  university_technical_college: 'technical college',
  studio: 'studio school',
};

function school(t: Record<string, string>, base: Place): School {
  const levels = (t['isced:level'] ?? '').split(/[;,]/).map((l) => l.trim());
  const kind = (t['school'] ?? '').toLowerCase();
  const primary = levels.includes('1') || /primary|infant|junior/.test(kind);
  const secondary = levels.includes('2') || levels.includes('3') || /secondary/.test(kind);
  const types = (t['school:type'] ?? '').toLowerCase().split(/[;,]/).map((x) => x.trim());
  const min = Number(t['min_age']);
  const max = Number(t['max_age']);
  return {
    ...base,
    urn: /^\d{5,6}$/.test(t['ref:edubase'] ?? '') ? t['ref:edubase'] : null,
    phase: primary && secondary ? 'All-through' : primary ? 'Primary' : secondary ? 'Secondary' : '',
    ages: Number.isFinite(min) && Number.isFinite(max) && max > min ? `ages ${min} to ${max}` : '',
    kind: types.map((x) => SCHOOL_TYPES[x]).filter(Boolean).join(', '),
    // An academy trust is tagged as a private operator on the map, so that tag does not mean fee-paying.
    independent: t['fee'] === 'yes' || types.includes('independent'),
    pupils: null,
    gender: '',
    selective: false,
    faith: '',
    ofsted: null,
    wales: false,
  };
}

/** A car park anyone can use: not marked private or for customers or permit holders, and identified by a name, an operator or a charge. */
function publicCarPark(t: Record<string, string>): boolean {
  if (/^(private|no|customers|permit|residents|delivery|employees|staff)$/.test(t['access'] ?? '')) return false;
  if (/^(street_side|lane|on_kerb|half_on_kerb)$/.test(t['parking'] ?? '')) return false;
  return !!(t['name'] || t['operator'] || t['fee'] || /multi-storey|underground/.test(t['parking'] ?? ''));
}

/**
 * Turns the raw map objects into the lists the report shows, nearest first.
 * `near` or `far` is null when that query failed, which leaves its lists empty and flagged, not shown as "none nearby".
 */
export function buildPlaces(lat: number, lng: number, near: OsmElement[] | null, far: OsmElement[] | null): Places {
  const placed = (els: OsmElement[] | null) =>
    (els ?? [])
      .map((e) => {
        const la = e.lat ?? e.center?.lat;
        const lo = e.lon ?? e.center?.lon;
        const t = e.tags ?? {};
        if (la === undefined || lo === undefined) return null;
        return { t, base: { name: (t['name'] ?? '').trim(), lat: la, lng: lo, distanceM: Math.round(distanceM(lat, lng, la, lo)) } as Place };
      })
      .filter((x): x is { t: Record<string, string>; base: Place } => x !== null)
      .sort((a, b) => a.base.distanceM - b.base.distanceM);
  const n = placed(near);
  const f = placed(far);
  const within = (list: typeof n, key: string, value: string, radius: number) => list.filter((x) => x.t[key] === value && x.base.distanceM <= radius);
  /** One site is often mapped twice (a building and its grounds); keep the nearest of each name. */
  const unique = <T extends Place>(list: T[]): T[] => list.filter((p, i) => !p.name || list.findIndex((q) => q.name === p.name) === i);

  const schools = unique(within(n, 'amenity', 'school', SEARCH.schools).filter((x) => x.base.name).map((x) => school(x.t, x.base)));
  const carParks: CarPark[] = within(n, 'amenity', 'parking', SEARCH.carParks)
    .filter((x) => publicCarPark(x.t))
    .map((x) => ({
      ...x.base,
      name: x.base.name || (x.t['operator'] ? `${x.t['operator']} car park` : 'Public car park'),
      fee: x.t['fee'] === 'yes' ? 'yes' : x.t['fee'] === 'no' ? 'no' : null,
      capacity: Number(x.t['capacity']) > 0 ? Number(x.t['capacity']) : null,
    }));
  const stations: Station[] = unique(
    within(f, 'railway', 'station', SEARCH.stations)
      // Heritage and miniature railways are not a way to get to work.
      .filter((x) => x.base.name && !/tourism|leisure/.test(x.t['usage'] ?? '') && !/miniature|funicular/.test(x.t['station'] ?? '') && !x.t['disused'] && !x.t['abandoned'])
      .map((x) => ({ ...x.base, kind: (x.t['station'] === 'subway' || x.t['station'] === 'light_rail' ? 'Metro or tram' : 'Rail') as Station['kind'] })),
  );
  const hospitals: Hospital[] = unique(within(f, 'amenity', 'hospital', SEARCH.hospitals).filter((x) => x.base.name).map((x) => ({ ...x.base, emergency: x.t['emergency'] === 'yes' })));
  const named = (key: string, value: string, radius: number) => unique(within(n, key, value, radius).map((x) => x.base));
  const doctors = named('amenity', 'doctors', SEARCH.doctors);
  const pharmacies = named('amenity', 'pharmacy', SEARCH.pharmacies);
  const supermarkets = named('shop', 'supermarket', SEARCH.supermarkets);
  const parks = named('leisure', 'park', SEARCH.parks);

  return {
    official: false,
    nearOk: near !== null,
    farOk: far !== null,
    schools: schools.slice(0, 8),
    schoolCount: schools.length,
    carParks: carParks.slice(0, 4),
    stations: stations.slice(0, 2),
    hospitals: hospitals.slice(0, 2),
    emergency: hospitals.find((h) => h.emergency) ?? null,
    doctors: doctors.slice(0, 2),
    pharmacy: pharmacies[0] ?? null,
    supermarket: supermarkets[0] ?? null,
    supermarketCount: supermarkets.length,
    park: parks[0] ?? null,
    busStops: within(n, 'highway', 'bus_stop', SEARCH.busStops).length,
  };
}

/** Distances read better in metres up close and in kilometres further out. */
export function metres(m: number): string {
  const tens = Math.round(m / 10) * 10;
  return tens < 1000 ? `${tens} m` : `${(m / 1000).toFixed(1)} km`;
}
