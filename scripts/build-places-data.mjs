// Builds the school, station and hospital data that ships with the app, from official open data.
//
//   node scripts/build-places-data.mjs
//
// Run it about once a month and commit what changes under public/data/places/.
// It needs Node 20 or later and no packages. Each source is downloaded fresh:
//
//   Schools    Get Information About Schools (Department for Education), Open Government Licence
//   Ofsted     State-funded school inspections and outcomes: management information (Ofsted), OGL
//   Stations   NaPTAN (Department for Transport), OGL
//   Hospitals  NHS website datasets (NHS England), OGL; emergency departments and Welsh hospitals
//              from OpenStreetMap, ODbL
//
// A source that cannot be reached leaves its existing output file untouched and the script exits with an error.

import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data', 'places');
const AGENT = 'OfferLadder data build (https://github.com/saeedmurrad/offerladder)';
/** Schools are split into squares of half a degree so the app only loads the few around a house. Keep in step with places-data.ts. */
const CELL = 0.5;

// ---------- helpers ----------

async function download(url, { tries = 3, timeoutMs = 240_000, post } = {}) {
  let last;
  for (let n = 0; n < tries; n++) {
    if (n) await new Promise((r) => setTimeout(r, 8000 * n));
    try {
      const res = await fetch(url, {
        method: post ? 'POST' : 'GET',
        body: post,
        headers: { 'User-Agent': AGENT, ...(post ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      last = new Error(`${res.status} from ${url}`);
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

/** Decodes as UTF-8 when the bytes are valid UTF-8, otherwise as Windows-1252 (several government files still are). */
function decode(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(buffer);
  }
}

/** A small CSV reader: quoted fields, doubled quotes, and line breaks inside quotes. Returns objects keyed by the header row. */
function parseCsv(text, delimiter = ',') {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  const head = rows.shift().map((h) => h.trim());
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}

/** Ordnance Survey grid reference (easting, northing in metres) to WGS84 latitude and longitude. Good to a few metres. */
function gridToLatLng(E, N) {
  const a = 6377563.396;
  const b = 6356256.909;
  const F0 = 0.9996012717;
  const lat0 = (49 * Math.PI) / 180;
  const lon0 = (-2 * Math.PI) / 180;
  const N0 = -100000;
  const E0 = 400000;
  const e2 = 1 - (b * b) / (a * a);
  const n = (a - b) / (a + b);
  let lat = lat0;
  let M = 0;
  do {
    lat = (N - N0 - M) / (a * F0) + lat;
    const Ma = (1 + n + (5 / 4) * n ** 2 + (5 / 4) * n ** 3) * (lat - lat0);
    const Mb = (3 * n + 3 * n ** 2 + (21 / 8) * n ** 3) * Math.sin(lat - lat0) * Math.cos(lat + lat0);
    const Mc = ((15 / 8) * n ** 2 + (15 / 8) * n ** 3) * Math.sin(2 * (lat - lat0)) * Math.cos(2 * (lat + lat0));
    const Md = (35 / 24) * n ** 3 * Math.sin(3 * (lat - lat0)) * Math.cos(3 * (lat + lat0));
    M = b * F0 * (Ma - Mb + Mc - Md);
  } while (N - N0 - M >= 0.00001);
  const sin = Math.sin(lat);
  const cos = Math.cos(lat);
  const nu = (a * F0) / Math.sqrt(1 - e2 * sin * sin);
  const rho = (a * F0 * (1 - e2)) / Math.pow(1 - e2 * sin * sin, 1.5);
  const eta2 = nu / rho - 1;
  const tan = Math.tan(lat);
  const sec = 1 / cos;
  const dE = E - E0;
  const VII = tan / (2 * rho * nu);
  const VIII = (tan / (24 * rho * nu ** 3)) * (5 + 3 * tan ** 2 + eta2 - 9 * tan ** 2 * eta2);
  const IX = (tan / (720 * rho * nu ** 5)) * (61 + 90 * tan ** 2 + 45 * tan ** 4);
  const X = sec / nu;
  const XI = (sec / (6 * nu ** 3)) * (nu / rho + 2 * tan ** 2);
  const XII = (sec / (120 * nu ** 5)) * (5 + 28 * tan ** 2 + 24 * tan ** 4);
  const XIIA = (sec / (5040 * nu ** 7)) * (61 + 662 * tan ** 2 + 1320 * tan ** 4 + 720 * tan ** 6);
  const latO = lat - VII * dE ** 2 + VIII * dE ** 4 - IX * dE ** 6;
  const lonO = lon0 + X * dE - XI * dE ** 3 + XII * dE ** 5 - XIIA * dE ** 7;

  // OSGB36 (Airy 1830) to WGS84 by a seven-parameter Helmert shift.
  const nuO = a / Math.sqrt(1 - e2 * Math.sin(latO) ** 2);
  const x1 = nuO * Math.cos(latO) * Math.cos(lonO);
  const y1 = nuO * Math.cos(latO) * Math.sin(lonO);
  const z1 = (1 - e2) * nuO * Math.sin(latO);
  const s = -20.4894e-6;
  const sec2rad = Math.PI / (180 * 3600);
  const rx = 0.1502 * sec2rad;
  const ry = 0.247 * sec2rad;
  const rz = 0.8421 * sec2rad;
  const x2 = 446.448 + (1 + s) * x1 - rz * y1 + ry * z1;
  const y2 = -125.157 + rz * x1 + (1 + s) * y1 - rx * z1;
  const z2 = 542.06 - ry * x1 + rx * y1 + (1 + s) * z1;
  const aW = 6378137;
  const bW = 6356752.3142;
  const e2W = 1 - (bW * bW) / (aW * aW);
  const p = Math.sqrt(x2 * x2 + y2 * y2);
  let latW = Math.atan2(z2, p * (1 - e2W));
  for (let i = 0; i < 6; i++) {
    const nuW = aW / Math.sqrt(1 - e2W * Math.sin(latW) ** 2);
    latW = Math.atan2(z2 + e2W * nuW * Math.sin(latW), p);
  }
  return [(latW * 180) / Math.PI, (Math.atan2(y2, x2) * 180) / Math.PI];
}

const round5 = (n) => Math.round(n * 1e5) / 1e5;
const metresApart = (lat1, lng1, lat2, lng2) => {
  const rad = Math.PI / 180;
  const x = (lng2 - lng1) * rad * Math.cos(((lat1 + lat2) / 2) * rad);
  const y = (lat2 - lat1) * rad;
  return Math.sqrt(x * x + y * y) * 6_371_000;
};
/** dd/mm/yyyy or dd-mm-yyyy to yyyy-mm; '' when it is not a date. */
const yearMonth = (d) => {
  const m = /^(\d{2})[/-](\d{2})[/-](\d{4})$/.exec(d ?? '');
  return m ? `${m[3]}-${m[2]}` : '';
};
const inEnglandOrWales = (lat, lng) => lat > 49.8 && lat < 55.9 && lng > -6.5 && lng < 1.9;

// ---------- Ofsted ----------

const REPORT_CARD = { Exceptional: 1, 'Strong standard': 2, 'Expected standard': 3, 'Needs attention': 4, 'Urgent improvement': 5 };

/**
 * The latest inspection result for each state school, as a short array the app turns into words:
 *   ['R', yyyy-mm, curriculum and teaching 1-5, achievement 1-5, safeguarding met 1/0]   report card (from November 2025)
 *   ['O', yyyy-mm, overall effectiveness 1-4]                                             the older single grade
 *   ['Q', yyyy-mm, quality of education 1-4]                                              older inspection with no single grade
 * followed by a category of concern ('SM', 'SWK' or 'RSI') or '', and 1 when the inspection was of the school this one replaced.
 */
async function ofstedByUrn() {
  const page = JSON.parse(decode(await download('https://www.gov.uk/api/content/government/statistical-data-sets/monthly-management-information-ofsteds-school-inspections-outcomes')));
  const links = [...(page.details?.body ?? '').matchAll(/https:\/\/assets\.publishing\.service\.gov\.uk\/[^"\s]+latest_inspections[^"\s]*\.csv/g)].map((m) => m[0]);
  if (!links.length) throw new Error('No "latest inspections" CSV is linked from the Ofsted page on gov.uk');
  const url = links[0];
  const rows = parseCsv(decode(await download(url)));
  const out = new Map();
  const val = (r, k) => (r[k] && r[k] !== 'NULL' ? r[k] : '');
  for (const r of rows) {
    const concern = val(r, 'Most recent category of concern');
    let result = null;
    const cardDate = yearMonth(val(r, 'Inspection start date'));
    const oldDate = yearMonth(val(r, 'Inspection start date of latest OEIF graded inspection'));
    if (cardDate && REPORT_CARD[val(r, 'Curriculum and teaching')]) {
      const former = val(r, 'Does the latest full inspection relate to the URN of the current school?') === 'No' ? 1 : 0;
      result = ['R', cardDate, REPORT_CARD[val(r, 'Curriculum and teaching')], REPORT_CARD[val(r, 'Achievement')] ?? 0, val(r, 'Safeguarding standards') === 'Not met' ? 0 : 1, concern, former];
    } else if (oldDate) {
      const former = val(r, 'Does the latest OEIF graded inspection relate to the URN of the current school?') === 'No' ? 1 : 0;
      const overall = Number(val(r, 'Latest OEIF overall effectiveness'));
      const quality = Number(val(r, 'Latest OEIF quality of education'));
      if (overall >= 1 && overall <= 4) result = ['O', oldDate, overall, concern, former];
      else if (quality >= 1 && quality <= 4) result = ['Q', oldDate, quality, concern, former];
    }
    if (result) out.set(r['URN'], result);
  }
  const asAt = /as_at_(\d{1,2}_[A-Za-z]+_\d{4})/.exec(url)?.[1].replace(/_/g, ' ') ?? '';
  return { byUrn: out, asAt };
}

// ---------- schools ----------

const KEEP_GROUPS = new Set(['Academies', 'Free Schools', 'Local authority maintained schools', 'Independent schools', 'Special schools', 'Welsh schools']);
const PHASES = { Primary: 'P', Secondary: 'S', 'All-through': 'A', Nursery: 'N', 'Middle deemed primary': 'M', 'Middle deemed secondary': 'M', '16 plus': '6' };

function schoolKind(group, type) {
  const t = type.toLowerCase();
  const special = t.includes('special') || group === 'Special schools';
  const alternative = t.includes('alternative provision') || t.includes('pupil referral');
  let base =
    group === 'Independent schools' || t.includes('independent')
      ? 'independent (fee-paying)'
      : group === 'Welsh schools'
        ? 'school in Wales'
        : group === 'Free Schools' || t.startsWith('free school') || t.includes('studio') || t.includes('technical college')
          ? t.includes('technical college')
            ? 'technical college'
            : t.includes('studio')
              ? 'studio school'
              : 'free school'
          : group === 'Academies'
            ? 'academy'
            : t.includes('voluntary aided')
              ? 'voluntary aided'
              : t.includes('voluntary controlled')
                ? 'voluntary controlled'
                : t.includes('foundation')
                  ? 'foundation school'
                  : t.includes('nursery')
                    ? 'nursery school'
                    : t.includes('community')
                      ? 'community school'
                      : '';
  if (alternative) base = base && base !== 'community school' ? `${base}, alternative provision` : 'alternative provision';
  else if (special) base = base && base !== 'community school' ? `${base}, special school` : 'special school';
  return base;
}

async function fetchGias() {
  for (let back = 0; back < 8; back++) {
    const d = new Date(Date.now() - back * 86_400_000);
    const stamp = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
    try {
      const buffer = await download(`https://ea-edubase-api-prod.azurewebsites.net/edubase/downloads/public/edubasealldata${stamp}.csv`, { tries: 1 });
      if (buffer.length > 5_000_000) return { buffer, date: `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6)}` };
    } catch {
      /* that day's extract is not there: try the day before */
    }
  }
  throw new Error('No Get Information About Schools extract could be downloaded for the last week');
}

async function buildSchools() {
  const [gias, ofsted] = await Promise.all([fetchGias(), ofstedByUrn()]);
  const rows = parseCsv(decode(gias.buffer));
  const cells = new Map();
  let count = 0;
  let rated = 0;
  for (const r of rows) {
    if (!r['EstablishmentStatus (name)'].startsWith('Open')) continue;
    const group = r['EstablishmentTypeGroup (name)'];
    if (!KEEP_GROUPS.has(group) || /overseas|online/i.test(r['TypeOfEstablishment (name)'])) continue;
    const E = Number(r['Easting']);
    const N = Number(r['Northing']);
    if (!(E > 0 && N > 0)) continue;
    const [lat, lng] = gridToLatLng(E, N);
    if (!inEnglandOrWales(lat, lng)) continue;
    const low = Number(r['StatutoryLowAge']) || 0;
    const high = Number(r['StatutoryHighAge']) || 0;
    // Special, independent and Welsh schools have no phase on record: read it from the ages taught where there are any.
    const phase = PHASES[r['PhaseOfEducation (name)']] ?? (high ? (high <= 11 ? 'P' : low >= 11 ? 'S' : 'A') : '');
    const gender = { Boys: 'B', Girls: 'G' }[r['Gender (name)']] ?? '';
    const faith = /^(does not apply|none|)$/i.test(r['ReligiousCharacter (name)']) ? '' : r['ReligiousCharacter (name)'];
    const rating = ofsted.byUrn.get(r['URN']) ?? null;
    if (rating) rated++;
    const record = [r['URN'], r['EstablishmentName'], round5(lat), round5(lng), phase, schoolKind(group, r['TypeOfEstablishment (name)']), low, high, Number(r['NumberOfPupils']) || 0, gender, r['AdmissionsPolicy (name)'] === 'Selective' ? 1 : 0, faith, rating];
    const key = `${Math.floor(lat / CELL)}_${Math.floor(lng / CELL)}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(record);
    count++;
  }
  if (count < 20_000) throw new Error(`Only ${count} schools read: the extract's layout has probably changed`);
  const dir = join(OUT, 'schools');
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  for (const [key, list] of cells) await writeFile(join(dir, `${key}.json`), JSON.stringify(list));
  return { schools: count, schoolsWithOfsted: rated, schoolCells: cells.size, schoolsDate: gias.date, ofstedAsAt: ofsted.asAt };
}

// ---------- stations ----------

async function buildStations() {
  const out = [];
  for (const [area, wanted, kind] of [
    ['910', 'RLY', 'R'],
    ['940', 'MET', 'M'],
  ]) {
    const rows = parseCsv(decode(await download(`https://naptan.api.dft.gov.uk/v1/access-nodes?dataFormat=csv&atcoAreaCodes=${area}`)));
    for (const r of rows) {
      if (r['StopType'] !== wanted || r['Status'] !== 'active') continue;
      // The metro and tram list also holds steam and heritage lines, each named with its operator in brackets.
      // Keep the networks people commute on; entries with no operator are London Underground, DLR and city trams.
      const operator = /\(([^)]+)\)\s*$/.exec(r['CommonName'])?.[1];
      if (kind === 'M' && operator && !/metrolink|metro\b|blackpool tramway|edinburgh trams|air-rail/i.test(operator)) continue;
      const lat = Number(r['Latitude']);
      const lng = Number(r['Longitude']);
      if (!lat || !lng) continue;
      out.push([r['CommonName'].replace(/\s+Rail Station$/i, '').replace(/\s+Station$/i, ''), round5(lat), round5(lng), kind]);
    }
  }
  if (out.length < 2500) throw new Error(`Only ${out.length} stations read from NaPTAN`);
  await writeFile(join(OUT, 'stations.json'), JSON.stringify(out));
  return { stations: out.length };
}

// ---------- hospitals ----------

async function buildHospitals() {
  // NHS England's own list gives the hospitals; it does not say which have an emergency department,
  // and it stops at the Welsh border, so those two come from OpenStreetMap.
  const nhs = parseCsv(decode(await download('https://assets.nhs.uk/data/foi/Hospital.csv')), '¬');
  const query = '[out:json][timeout:120];area["ISO3166-2"="GB-ENG"]->.eng;area["ISO3166-2"="GB-WLS"]->.wls;(nwr[amenity=hospital][emergency=yes](area.eng);nwr[amenity=hospital](area.wls););out center tags;';
  const osm = JSON.parse(decode(await download('https://overpass-api.de/api/interpreter', { post: 'data=' + encodeURIComponent(query), tries: 6 }))).elements.map((e) => ({
    name: e.tags?.name ?? '',
    lat: e.lat ?? e.center?.lat,
    lng: e.lon ?? e.center?.lon,
    emergency: e.tags?.emergency === 'yes',
  }));
  const emergency = osm.filter((h) => h.emergency && h.lat);
  if (emergency.length < 120) throw new Error(`Only ${emergency.length} emergency departments read from OpenStreetMap`);
  const out = [];
  const used = new Set();
  for (const r of nhs) {
    if (!['Hospital', 'Mental Health Hospital'].includes(r['SubType']) || r['OrganisationStatus'] !== 'Visible') continue;
    const lat = Number(r['Latitude']);
    const lng = Number(r['Longitude']);
    if (!lat || !lng) continue;
    const mental = r['SubType'] === 'Mental Health Hospital';
    const match = mental ? null : emergency.find((e) => metresApart(lat, lng, e.lat, e.lng) < 600);
    if (match) used.add(match);
    out.push([r['OrganisationName'], round5(lat), round5(lng), r['Sector'] === 'NHS Sector' ? 'N' : 'I', match ? 1 : 0, mental ? 1 : 0]);
  }
  // Emergency departments with no NHS-list hospital beside them, and every hospital in Wales.
  for (const h of osm) {
    if (!h.lat || !h.name || used.has(h)) continue;
    const welsh = !h.emergency || !out.some((o) => metresApart(h.lat, h.lng, o[1], o[2]) < 600);
    if (welsh) out.push([h.name, round5(h.lat), round5(h.lng), '', h.emergency ? 1 : 0, 0]);
  }
  await writeFile(join(OUT, 'hospitals.json'), JSON.stringify(out));
  return { hospitals: out.length, emergencyDepartments: out.filter((h) => h[4]).length };
}

// ---------- run ----------

await mkdir(OUT, { recursive: true });
const metaPath = join(OUT, 'meta.json');
const meta = existsSync(metaPath) ? JSON.parse(await readFile(metaPath, 'utf8')) : {};
let failed = false;
for (const [name, build] of [
  ['schools', buildSchools],
  ['stations', buildStations],
  ['hospitals', buildHospitals],
]) {
  try {
    const result = await build();
    Object.assign(meta, result, { [`${name}Built`]: new Date().toISOString().slice(0, 10) });
    console.log(`${name}:`, JSON.stringify(result));
  } catch (e) {
    failed = true;
    console.error(`${name} NOT updated, existing file kept:`, e.message);
  }
}
await writeFile(metaPath, JSON.stringify(meta, null, 2) + '\n');
const files = existsSync(join(OUT, 'schools')) ? (await readdir(join(OUT, 'schools'))).length : 0;
console.log(`Wrote ${files} school files to ${OUT}`);
process.exit(failed ? 1 : 0);
