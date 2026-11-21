import { Hospital, OfstedResult, School, Station } from './models';
import { distanceM } from './places';

/**
 * Reads the school, station and hospital files that ship with the app (built by scripts/build-places-data.mjs
 * from official open data). They load from the app's own address, so they are quick and always there.
 */

/** Schools are stored in squares of half a degree. Keep in step with the build script. */
export const CELL = 0.5;

/** How far out each kind of place is looked for, in metres. */
export const RANGE = { schools: 1600, stations: 15_000, hospitals: 25_000, emergency: 40_000 };

/** [urn, name, lat, lng, phase, kind, lowest age, highest age, pupils, gender, selective, faith, ofsted] */
export type SchoolRecord = [string, string, number, number, string, string, number, number, number, string, number, string, OfstedRecord | null];
/** ['R', month, curriculum 1-5, achievement 1-5, safeguarding met, concern, former] or ['O' | 'Q', month, grade 1-4, concern, former] */
export type OfstedRecord = ['R', string, number, number, number, string, number] | ['O' | 'Q', string, number, string, number];
/** [name, lat, lng, 'R' rail or 'M' metro and tram] */
export type StationRecord = [string, number, number, string];
/** [name, lat, lng, 'N' NHS / 'I' independent / '' not known, emergency department, mental health hospital] */
export type HospitalRecord = [string, number, number, string, number, number];

/** The files holding every school within `radiusM` of a point: one, or up to four near the edge of a square. */
export function schoolCells(lat: number, lng: number, radiusM: number): string[] {
  const dLat = radiusM / 111_320;
  const dLng = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
  const keys = new Set<string>();
  for (const la of [lat - dLat, lat + dLat]) for (const lo of [lng - dLng, lng + dLng]) keys.add(`${Math.floor(la / CELL)}_${Math.floor(lo / CELL)}`);
  return [...keys];
}

const PHASES: Record<string, School['phase']> = { P: 'Primary', S: 'Secondary', A: 'All-through', N: 'Nursery', M: 'Middle', '6': 'Sixth form' };
const OLD_GRADES = ['', 'Outstanding', 'Good', 'Requires improvement', 'Inadequate'];
const CARD_GRADES = ['', 'Exceptional', 'Strong', 'Expected standard', 'Needs attention', 'Urgent improvement'];
const CONCERNS: Record<string, string> = { SM: 'in special measures', SWK: 'serious weaknesses', RSI: 'requires significant improvement' };

function monthYear(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1] ?? ''} ${y}`.trim();
}

/**
 * Ofsted's latest result in words. Ofsted stopped giving one overall grade in September 2024 and moved to
 * report cards in November 2025, so three shapes exist side by side; each is reported as Ofsted gave it.
 */
export function ofstedResult(r: OfstedRecord | null): OfstedResult | null {
  if (!r) return null;
  let text: string;
  let concern: string;
  let former: number;
  /** 1 best to 5 worst, on whichever scale was used, for marking the weak ones. */
  let weak: boolean;
  if (r[0] === 'R') {
    const [, , curriculum, achievement, safeguarding] = r;
    text = `Curriculum and teaching: ${CARD_GRADES[curriculum]}${achievement ? `; achievement: ${CARD_GRADES[achievement]}` : ''}${safeguarding ? '' : '; safeguarding not met'}`;
    weak = curriculum >= 4 || achievement >= 4 || !safeguarding;
    concern = r[5];
    former = r[6];
  } else {
    text = r[0] === 'O' ? OLD_GRADES[r[2]] : `Quality of education: ${OLD_GRADES[r[2]]}`;
    weak = r[2] >= 3;
    concern = r[3];
    former = r[4];
  }
  return { text, inspected: monthYear(r[1]), concern: CONCERNS[concern] ?? '', weak: weak || !!CONCERNS[concern], former: !!former };
}

/** Schools within a mile, nearest first. */
export function schoolsNear(records: SchoolRecord[], lat: number, lng: number, radiusM = RANGE.schools): School[] {
  return records
    .map((r) => ({ r, distanceM: Math.round(distanceM(lat, lng, r[2], r[3])) }))
    .filter((x) => x.distanceM <= radiusM)
    .sort((a, b) => a.distanceM - b.distanceM)
    .map(({ r, distanceM }) => ({
      name: r[1],
      lat: r[2],
      lng: r[3],
      distanceM,
      urn: r[0],
      phase: PHASES[r[4]] ?? '',
      ages: r[7] > r[6] ? `ages ${r[6]} to ${r[7]}` : '',
      kind: r[5],
      independent: r[5].startsWith('independent'),
      pupils: r[8] || null,
      gender: r[9] === 'B' ? 'boys' : r[9] === 'G' ? 'girls' : '',
      selective: !!r[10],
      faith: r[11],
      ofsted: ofstedResult(r[12]),
      wales: r[5] === 'school in Wales',
    }));
}

/** The two nearest stations, rail or metro. */
export function stationsNear(records: StationRecord[], lat: number, lng: number, radiusM = RANGE.stations): Station[] {
  return records
    .map((r) => ({ name: r[0], lat: r[1], lng: r[2], distanceM: Math.round(distanceM(lat, lng, r[1], r[2])), kind: (r[3] === 'R' ? 'Rail' : 'Metro or tram') as Station['kind'] }))
    .filter((s) => s.distanceM <= radiusM)
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, 2);
}

/**
 * The nearest general hospitals and the nearest emergency department.
 * Private hospitals and mental-health units are left out: neither is where you go when something happens.
 */
export function hospitalsNear(records: HospitalRecord[], lat: number, lng: number): { hospitals: Hospital[]; emergency: Hospital | null } {
  const all = records
    .filter((r) => r[3] !== 'I' && !r[5])
    .map((r) => ({ name: r[0], lat: r[1], lng: r[2], distanceM: Math.round(distanceM(lat, lng, r[1], r[2])), emergency: !!r[4] }))
    .sort((a, b) => a.distanceM - b.distanceM);
  return {
    hospitals: all.filter((h) => h.distanceM <= RANGE.hospitals).slice(0, 2),
    emergency: all.find((h) => h.emergency && h.distanceM <= RANGE.emergency) ?? null,
  };
}
