import { Injectable } from '@angular/core';
import { Amenities, AreaData, CrimeSummary, FloodSummary, Geo, Hpi, PropertyType, Sale } from './models';

const POSTCODES = 'https://api.postcodes.io';
const LAND_REGISTRY = 'https://landregistry.data.gov.uk/landregistry/query';
const POLICE = 'https://data.police.uk/api';
const FLOOD = 'https://environment.data.gov.uk/flood-monitoring/id/floodAreas';
const OVERPASS = 'https://overpass-api.de/api/interpreter';

const TYPE_MAP: Record<string, PropertyType> = {
  terraced: 'terraced',
  'semi-detached': 'semi-detached',
  detached: 'detached',
  'flat-maisonette': 'flat-maisonette',
  otherPropertyType: 'other',
};

/** All data comes straight from public open-data services, read in the visitor's browser. Nothing is stored on a server. */
@Injectable({ providedIn: 'root' })
export class DataService {
  async lookupPostcode(postcode: string): Promise<Geo> {
    const res = await fetch(`${POSTCODES}/postcodes/${encodeURIComponent(postcode.replace(/\s+/g, ''))}`);
    if (res.status === 404) throw new Error(`Postcode "${postcode}" was not found. Check it and try again.`);
    if (!res.ok) throw new Error('The postcode service did not respond. Try again in a minute.');
    const r = (await res.json()).result;
    return {
      postcode: r.postcode,
      outcode: r.outcode,
      lat: r.latitude,
      lng: r.longitude,
      ward: r.admin_ward ?? '',
      district: r.admin_district ?? '',
      districtCode: r.codes?.admin_district ?? '',
      country: r.country ?? '',
      lsoa: r.lsoa ?? '',
      lsoaCode: r.codes?.lsoa ?? '',
    };
  }

  /** Up to 100 nearest postcodes per point, with distance in metres from the subject. A wide search adds four points 450 m out. */
  async nearbyPostcodes(geo: Geo, wide: boolean): Promise<Map<string, number>> {
    const points: [number, number][] = [[geo.lat, geo.lng]];
    if (wide) {
      const dLat = 450 / 111_320;
      const dLng = 450 / (111_320 * Math.cos((geo.lat * Math.PI) / 180));
      points.push([geo.lat + dLat, geo.lng], [geo.lat - dLat, geo.lng], [geo.lat, geo.lng + dLng], [geo.lat, geo.lng - dLng]);
    }
    const out = new Map<string, number>();
    const lists = await Promise.all(
      points.map(async ([lat, lng]) => {
        const res = await fetch(`${POSTCODES}/postcodes?lon=${lng}&lat=${lat}&radius=2000&limit=100`);
        if (!res.ok) return [];
        return ((await res.json()).result ?? []) as { postcode: string; latitude: number; longitude: number }[];
      }),
    );
    for (const list of lists) {
      for (const p of list) {
        if (!out.has(p.postcode)) out.set(p.postcode, Math.round(distanceM(geo.lat, geo.lng, p.latitude, p.longitude)));
      }
    }
    out.set(geo.postcode, 0);
    return out;
  }

  /** HM Land Registry price-paid records for a set of postcodes. sinceDate is yyyy-mm-dd, or null for the full history. */
  async sales(postcodes: Map<string, number>, sinceDate: string | null): Promise<Sale[]> {
    const values = [...postcodes.keys()].map((p) => `"${p.replace(/"/g, '')}"`).join(' ');
    const filter = sinceDate ? `FILTER(?date >= "${sinceDate}"^^<http://www.w3.org/2001/XMLSchema#date>)` : '';
    const query = `
      PREFIX lrppi: <http://landregistry.data.gov.uk/def/ppi/>
      PREFIX lrcommon: <http://landregistry.data.gov.uk/def/common/>
      SELECT ?paon ?saon ?street ?postcode ?amount ?date ?type ?cat WHERE {
        VALUES ?postcode { ${values} }
        ?addr lrcommon:postcode ?postcode .
        ?tx lrppi:propertyAddress ?addr ; lrppi:pricePaid ?amount ; lrppi:transactionDate ?date ; lrppi:propertyType ?type .
        OPTIONAL { ?tx lrppi:transactionCategory ?cat }
        OPTIONAL { ?addr lrcommon:paon ?paon }
        OPTIONAL { ?addr lrcommon:saon ?saon }
        OPTIONAL { ?addr lrcommon:street ?street }
        ${filter}
      } ORDER BY DESC(?date) LIMIT 3000`;
    const res = await fetch(LAND_REGISTRY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/sparql-results+json' },
      body: 'query=' + encodeURIComponent(query),
    });
    if (!res.ok) throw new Error('HM Land Registry did not respond. Try again in a minute.');
    const rows = (await res.json()).results.bindings as Record<string, { value: string }>[];
    const tail = (uri?: string) => (uri ? uri.slice(uri.lastIndexOf('/') + 1) : '');
    return rows.map((r) => ({
      paon: r['paon']?.value ?? '',
      saon: r['saon']?.value ?? '',
      street: r['street']?.value ?? '',
      postcode: r['postcode'].value,
      price: Number(r['amount'].value),
      date: r['date'].value.slice(0, 10),
      type: TYPE_MAP[tail(r['type']?.value)] ?? 'other',
      standard: tail(r['cat']?.value) !== 'additionalPricePaidTransaction',
      distanceM: postcodes.get(r['postcode'].value) ?? null,
    }));
  }

  /** Area context is useful, not essential: a failure in any one source must not block the report. */
  async area(geo: Geo): Promise<AreaData> {
    const [crime, flood, hpi, amenities] = await Promise.all([
      // each source fails on its own without affecting the others
      this.crime(geo).catch(() => null),
      this.flood(geo).catch(() => null),
      this.hpi(geo).catch(() => null),
      this.amenities(geo).catch(() => null),
    ]);
    return { crime, flood, hpi, amenities };
  }

  /** Latest UK House Price Index figures for the council area, matched by its official area code. */
  private async hpi(geo: Geo): Promise<Hpi | null> {
    if (!/^[EW]\d{8}$/.test(geo.districtCode)) return null;
    const query = `
      PREFIX ukhpi: <http://landregistry.data.gov.uk/def/ukhpi/>
      PREFIX owl: <http://www.w3.org/2002/07/owl#>
      SELECT ?month ?avg ?chg ?terr ?semi ?det ?flat WHERE {
        ?region owl:sameAs <http://statistics.data.gov.uk/id/statistical-geography/${geo.districtCode}> .
        ?obs ukhpi:refRegion ?region ; ukhpi:refMonth ?month ; ukhpi:averagePrice ?avg .
        OPTIONAL { ?obs ukhpi:percentageAnnualChange ?chg }
        OPTIONAL { ?obs ukhpi:averagePriceTerraced ?terr }
        OPTIONAL { ?obs ukhpi:averagePriceSemiDetached ?semi }
        OPTIONAL { ?obs ukhpi:averagePriceDetached ?det }
        OPTIONAL { ?obs ukhpi:averagePriceFlatMaisonette ?flat }
      } ORDER BY DESC(?month) LIMIT 1`;
    const res = await fetch(LAND_REGISTRY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/sparql-results+json' },
      body: 'query=' + encodeURIComponent(query),
    });
    if (!res.ok) return null;
    const r = ((await res.json()).results.bindings as Record<string, { value: string }>[])[0];
    if (!r) return null;
    const n = (k: string) => (r[k] ? Number(r[k].value) : undefined);
    const byType: Hpi['byType'] = {};
    if (n('terr')) byType['terraced'] = n('terr');
    if (n('semi')) byType['semi-detached'] = n('semi');
    if (n('det')) byType['detached'] = n('det');
    if (n('flat')) byType['flat-maisonette'] = n('flat');
    return { month: r['month'].value.slice(0, 7), average: Number(r['avg'].value), annualChangePct: n('chg') ?? null, byType };
  }

  /** Nearest railway station within 3 km, and schools and supermarkets within 1 km. The public server is often busy, so give up after 8 seconds. */
  private async amenities(geo: Geo): Promise<Amenities | null> {
    const at = `${geo.lat},${geo.lng}`;
    const q = `[out:json][timeout:5];(node(around:3000,${at})[railway=station];nwr(around:1000,${at})[amenity=school];nwr(around:1000,${at})[shop=supermarket];);out center tags 120;`;
    const res = await fetch(OVERPASS, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    type El = { lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> };
    const els = ((await res.json()).elements ?? []) as El[];
    let station: Amenities['station'] = null;
    let schools = 0;
    let supermarkets = 0;
    for (const e of els) {
      const t = e.tags ?? {};
      if (t['amenity'] === 'school') schools++;
      else if (t['shop'] === 'supermarket') supermarkets++;
      else if (t['railway'] === 'station') {
        const lat = e.lat ?? e.center?.lat;
        const lon = e.lon ?? e.center?.lon;
        if (lat === undefined || lon === undefined) continue;
        const d = Math.round(distanceM(geo.lat, geo.lng, lat, lon));
        if (!station || d < station.distanceM) station = { name: t['name'] ?? 'Railway station', distanceM: d };
      }
    }
    return { station, schools, supermarkets };
  }

  private async crime(geo: Geo): Promise<CrimeSummary | null> {
    const res = await fetch(`${POLICE}/crimes-street/all-crime?lat=${geo.lat}&lng=${geo.lng}`);
    if (!res.ok) return null;
    const rows = (await res.json()) as { category: string; month: string }[];
    if (!rows.length) return null;
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
    const top = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([category, count]) => ({ category: category.replace(/-/g, ' '), count }));
    return { month: rows[0].month, total: rows.length, top };
  }

  private async flood(geo: Geo): Promise<FloodSummary | null> {
    const res = await fetch(`${FLOOD}?lat=${geo.lat}&long=${geo.lng}&dist=1`);
    if (!res.ok) return null;
    const items = ((await res.json()).items ?? []) as { label?: string; description?: string }[];
    return { areas: items.map((i) => i.label ?? i.description ?? 'Flood area').slice(0, 5) };
  }
}

function distanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = Math.PI / 180;
  const x = (lng2 - lng1) * rad * Math.cos(((lat1 + lat2) / 2) * rad);
  const y = (lat2 - lat1) * rad;
  return Math.sqrt(x * x + y * y) * 6_371_000;
}
