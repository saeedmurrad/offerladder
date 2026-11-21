import { Injectable } from '@angular/core';
import { AreaData, AreaSeries, CrimeSummary, DemandData, FloodSummary, Geo, Hpi, HpiMonth, Journeys, Places, PlacesMeta, PropertyType, Route, Sale } from './models';
import { HospitalRecord, hospitalsNear, RANGE, schoolCells, SchoolRecord, schoolsNear, StationRecord, stationsNear } from './places-data';
import { buildPlaces, distanceM, OsmElement, placeQueries } from './places';

const POSTCODES = 'https://api.postcodes.io';
const LAND_REGISTRY = 'https://landregistry.data.gov.uk/landregistry/query';
const POLICE = 'https://data.police.uk/api';
const FLOOD = 'https://environment.data.gov.uk/flood-monitoring/id/floodAreas';
const OVERPASS = 'https://overpass-api.de/api/interpreter';
/** The public map server is often busy: a query can take half a minute, or fail and work on the next try. */
const OVERPASS_TIMEOUT_MS = 60_000;
/** A busy server refuses at once and often accepts a moment later, so wait a little longer before each new try. */
const OVERPASS_RETRY_WAITS_MS = [1500, 4000];
/** Walking and driving routes on OpenStreetMap roads and paths (FOSSGIS routing server). */
const ROUTING = 'https://routing.openstreetmap.de';
const NOMIS = 'https://www.nomisweb.co.uk/api/v01/dataset';
/** Nomis datasets: mid-year population estimates, earnings by place of residence, claimant count. */
const NOMIS_POPULATION = 'NM_2002_1';
const NOMIS_EARNINGS = 'NM_99_1';
const NOMIS_CLAIMANTS = 'NM_162_1';
/** The demand outlook looks back this far. */
const DEMAND_YEARS = 7;
const COUNTRIES: Record<string, { code: string; region: string }> = {
  England: { code: 'E92000001', region: 'england' },
  Wales: { code: 'W92000004', region: 'wales' },
};

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

  /**
   * Every recorded sale on a street, found by street name plus either the postcode district ("PE1") or the town.
   * Used to identify a house from a listing that hides its number.
   */
  async streetSales(street: string, outcode: string | null, towns: string[]): Promise<Sale[]> {
    const clean = (s: string) => s.toUpperCase().replace(/[^A-Z0-9 '&-]/g, '').replace(/\s+/g, ' ').trim();
    const name = clean(street);
    if (!name) return [];
    const attempts = outcode ? [`FILTER(STRSTARTS(?postcode, "${clean(outcode)} "))`] : towns.map((t) => `?addr lrcommon:town "${clean(t)}" .`);
    for (const constraint of attempts.slice(0, 3)) {
      const query = `
        PREFIX lrppi: <http://landregistry.data.gov.uk/def/ppi/>
        PREFIX lrcommon: <http://landregistry.data.gov.uk/def/common/>
        SELECT ?paon ?saon ?postcode ?amount ?date ?type WHERE {
          ?addr lrcommon:street "${name}" ; lrcommon:postcode ?postcode .
          ${constraint.startsWith('?addr') ? constraint : ''}
          ?tx lrppi:propertyAddress ?addr ; lrppi:pricePaid ?amount ; lrppi:transactionDate ?date ; lrppi:propertyType ?type .
          OPTIONAL { ?addr lrcommon:paon ?paon }
          OPTIONAL { ?addr lrcommon:saon ?saon }
          ${constraint.startsWith('FILTER') ? constraint : ''}
        } LIMIT 4000`;
      const res = await fetch(LAND_REGISTRY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/sparql-results+json' },
        body: 'query=' + encodeURIComponent(query),
      });
      if (!res.ok) continue;
      const rows = (await res.json()).results.bindings as Record<string, { value: string }>[];
      if (!rows.length) continue;
      const tail = (uri?: string) => (uri ? uri.slice(uri.lastIndexOf('/') + 1) : '');
      return rows.map((r) => ({
        paon: r['paon']?.value ?? '',
        saon: r['saon']?.value ?? '',
        street: name,
        postcode: r['postcode'].value,
        price: Number(r['amount'].value),
        date: r['date'].value.slice(0, 10),
        type: TYPE_MAP[tail(r['type']?.value)] ?? 'other',
        standard: true,
        distanceM: null,
      }));
    }
    return [];
  }

  /**
   * How far prices of this property type have moved in the council area since a month (yyyy-mm), as a ratio:
   * 1.04 means 4% up. From the UK House Price Index, which runs about two months behind.
   * Null when the index does not cover the area or the month, which includes a sale newer than the latest index month.
   */
  async priceMove(geo: Geo, type: PropertyType, sinceMonth: string): Promise<number | null> {
    if (!/^[EW]\d{8}$/.test(geo.districtCode) || !/^\d{4}-\d{2}$/.test(sinceMonth)) return null;
    const byType: Partial<Record<PropertyType, string>> = {
      terraced: 'housePriceIndexTerraced',
      'semi-detached': 'housePriceIndexSemiDetached',
      detached: 'housePriceIndexDetached',
      'flat-maisonette': 'housePriceIndexFlatMaisonette',
    };
    const typed = byType[type];
    const query = `
      PREFIX ukhpi: <http://landregistry.data.gov.uk/def/ukhpi/>
      PREFIX owl: <http://www.w3.org/2002/07/owl#>
      PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
      SELECT ?month ?all ?typed WHERE {
        ?region owl:sameAs|rdfs:seeAlso <http://statistics.data.gov.uk/id/statistical-geography/${geo.districtCode}> .
        ?obs ukhpi:refRegion ?region ; ukhpi:refMonth ?month ; ukhpi:housePriceIndex ?all .
        ${typed ? `OPTIONAL { ?obs ukhpi:${typed} ?typed }` : ''}
        FILTER(?month >= "${sinceMonth}"^^<http://www.w3.org/2001/XMLSchema#gYearMonth>)
      } ORDER BY ?month LIMIT 200`;
    const res = await fetch(LAND_REGISTRY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/sparql-results+json' },
      body: 'query=' + encodeURIComponent(query),
    });
    if (!res.ok) return null;
    const rows = (await res.json()).results.bindings as Record<string, { value: string }>[];
    // No rows: the area is not in the index, or the sale is newer than the latest index month.
    // The index must also start in the month of the sale, or the movement would be measured from the wrong point.
    if (!rows.length || rows[0]['month'].value.slice(0, 7) !== sinceMonth) return null;
    const first = rows[0];
    const last = rows[rows.length - 1];
    const key = first['typed'] && last['typed'] ? 'typed' : 'all';
    const from = Number(first[key].value);
    const to = Number(last[key].value);
    return from > 0 && to > 0 ? to / from : null;
  }

  private readonly demandCache = new Map<string, Promise<DemandData | null>>();

  /**
   * Seven years of prices, sales, population, earnings and claimants for the council area and for its country.
   * Each source fails on its own: a missing one leaves its series empty and its indicator unscored.
   * Kept for the visit, so analysing a second house in the same council area asks nothing again.
   */
  demand(geo: Geo): Promise<DemandData | null> {
    const country = COUNTRIES[geo.country];
    if (!country || !/^[EW]\d{8}$/.test(geo.districtCode)) return Promise.resolve(null);
    let pending = this.demandCache.get(geo.districtCode);
    if (!pending) {
      pending = this.loadDemand(geo, country).catch(() => null);
      this.demandCache.set(geo.districtCode, pending);
      // Nothing came back at all (offline, or every source down): let the next analysis try again.
      void pending.then((d) => {
        if (!d || (!d.area.hpi.length && !d.area.population.length)) this.demandCache.delete(geo.districtCode);
      });
    }
    return pending;
  }

  private async loadDemand(geo: Geo, country: { code: string; region: string }): Promise<DemandData> {
    const since = new Date();
    since.setFullYear(since.getFullYear() - DEMAND_YEARS);
    const sinceMonth = since.toISOString().slice(0, 7);
    const codes = [geo.districtCode, country.code];
    const yearly = (rows: [string, string, number][], code: string) => rows.filter((r) => r[0] === code).map((r) => [Number(r[1]), r[2]] as [number, number]);
    const [areaHpi, countryHpi, population, earnings, claimants] = await Promise.all([
      this.hpiSeries(`?region owl:sameAs|rdfs:seeAlso <http://statistics.data.gov.uk/id/statistical-geography/${geo.districtCode}> .`, sinceMonth).catch(() => []),
      this.hpiSeries(`VALUES ?region { <http://landregistry.data.gov.uk/id/region/${country.region}> }`, sinceMonth).catch(() => []),
      this.nomis(NOMIS_POPULATION, codes, 'gender=0&c_age=200&measures=20100&time=latestMINUS5,latest').catch(() => []),
      this.nomis(NOMIS_EARNINGS, codes, 'sex=8&item=2&pay=7&measures=20100&time=latestMINUS5,latest').catch(() => []),
      this.nomis(NOMIS_CLAIMANTS, codes, 'gender=0&age=0&measure=2&measures=20100&time=latestMINUS12,latest').catch(() => []),
    ]);
    const series = (hpi: HpiMonth[], code: string): AreaSeries => ({
      hpi,
      population: yearly(population, code),
      earnings: yearly(earnings, code),
      claimants: claimants.filter((r) => r[0] === code).map((r) => [r[1], r[2]] as [string, number]),
    });
    return { areaName: geo.district, countryName: geo.country, area: series(areaHpi, geo.districtCode), country: series(countryHpi, country.code) };
  }

  /** Monthly UK House Price Index rows for one region, oldest first. `region` is a SPARQL pattern that binds ?region. */
  private async hpiSeries(region: string, sinceMonth: string): Promise<HpiMonth[]> {
    const query = `
      PREFIX ukhpi: <http://landregistry.data.gov.uk/def/ukhpi/>
      PREFIX owl: <http://www.w3.org/2002/07/owl#>
      PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
      SELECT ?month ?avg ?idx ?terr ?semi ?det ?flat ?vol ?nb WHERE {
        ${region}
        ?obs ukhpi:refRegion ?region ; ukhpi:refMonth ?month ; ukhpi:averagePrice ?avg ; ukhpi:housePriceIndex ?idx .
        OPTIONAL { ?obs ukhpi:housePriceIndexTerraced ?terr }
        OPTIONAL { ?obs ukhpi:housePriceIndexSemiDetached ?semi }
        OPTIONAL { ?obs ukhpi:housePriceIndexDetached ?det }
        OPTIONAL { ?obs ukhpi:housePriceIndexFlatMaisonette ?flat }
        OPTIONAL { ?obs ukhpi:salesVolume ?vol }
        OPTIONAL { ?obs ukhpi:salesVolumeNewBuild ?nb }
        FILTER(?month >= "${sinceMonth}"^^<http://www.w3.org/2001/XMLSchema#gYearMonth>)
      } ORDER BY ?month LIMIT 200`;
    const res = await fetch(LAND_REGISTRY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/sparql-results+json' },
      body: 'query=' + encodeURIComponent(query),
    });
    if (!res.ok) return [];
    const rows = (await res.json()).results.bindings as Record<string, { value: string }>[];
    const out = new Map<string, HpiMonth>();
    for (const r of rows) {
      const n = (k: string) => (r[k] ? Number(r[k].value) : null);
      const byType: HpiMonth['byType'] = {};
      if (n('terr')) byType['terraced'] = n('terr') as number;
      if (n('semi')) byType['semi-detached'] = n('semi') as number;
      if (n('det')) byType['detached'] = n('det') as number;
      if (n('flat')) byType['flat-maisonette'] = n('flat') as number;
      const month = r['month'].value.slice(0, 7);
      // An area linked to the index twice comes back twice; keep one row a month.
      out.set(month, { month, average: Number(r['avg'].value), index: Number(r['idx'].value), byType, sales: n('vol'), newBuild: n('nb') });
    }
    return [...out.values()];
  }

  /** One Nomis table for several areas, as [area code, period, value] rows, oldest first. */
  private async nomis(dataset: string, codes: string[], params: string): Promise<[string, string, number][]> {
    const res = await fetch(`${NOMIS}/${dataset}.data.json?geography=${codes.join(',')}&${params}`, { signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return [];
    type Obs = { geography: { geogcode: string }; time: { value: string }; obs_value: { value: number | null } };
    const obs = ((await res.json()).obs ?? []) as Obs[];
    return obs
      .filter((o) => typeof o.obs_value?.value === 'number')
      .map((o) => [o.geography.geogcode, String(o.time.value), o.obs_value.value as number] as [string, string, number])
      .sort((a, b) => a[1].localeCompare(b[1]));
  }

  /** Area context is useful, not essential: a failure in any one source must not block the report. */
  async area(geo: Geo): Promise<AreaData> {
    const [crime, flood, hpi] = await Promise.all([
      // each source fails on its own without affecting the others
      this.crime(geo).catch(() => null),
      this.flood(geo).catch(() => null),
      this.hpi(geo).catch(() => null),
    ]);
    return { crime, flood, hpi };
  }

  private readonly bundled = new Map<string, Promise<unknown>>();

  /** One of the data files that ship with the app, read once a visit. A square with no schools has no file, which is an empty list. */
  private file<T>(path: string, missing?: T): Promise<T> {
    let pending = this.bundled.get(path) as Promise<T> | undefined;
    if (!pending) {
      pending = fetch(new URL(`data/places/${path}`, document.baseURI)).then(async (res) => {
        if (res.status === 404 && missing !== undefined) return missing;
        if (!res.ok) throw new Error(`${path}: ${res.status}`);
        return (await res.json()) as T;
      });
      this.bundled.set(path, pending);
      pending.catch(() => this.bundled.delete(path));
    }
    return pending;
  }

  placesMeta(): Promise<PlacesMeta | null> {
    return this.file<PlacesMeta>('meta.json').catch(() => null);
  }

  /**
   * Schools with their Ofsted results, stations and hospitals around the house, from the official data that ships with the app.
   * Quick and not dependent on anyone else's server. Car parks, GPs and shops are filled in afterwards by `nearbyExtras`.
   * Null if the files cannot be read, in which case `places` reads everything from the map instead.
   */
  async officialPlaces(geo: Geo): Promise<Places | null> {
    try {
      const [cells, stations, hospitals] = await Promise.all([
        Promise.all(schoolCells(geo.lat, geo.lng, RANGE.schools).map((key) => this.file<SchoolRecord[]>(`schools/${key}.json`, []))),
        this.file<StationRecord[]>('stations.json'),
        this.file<HospitalRecord[]>('hospitals.json'),
      ]);
      const schools = schoolsNear(cells.flat(), geo.lat, geo.lng);
      return {
        ...buildPlaces(geo.lat, geo.lng, null, null),
        official: true,
        farOk: true,
        schools: schools.slice(0, 10),
        schoolCount: schools.length,
        stations: stationsNear(stations, geo.lat, geo.lng),
        ...hospitalsNear(hospitals, geo.lat, geo.lng),
      };
    } catch {
      return null;
    }
  }

  /** Car parks, GPs, pharmacies, shops, parks and bus stops from the map, to add to the official places. Null if the map server does not answer. */
  async nearbyExtras(geo: Geo): Promise<Places | null> {
    const near = await this.overpass(placeQueries(geo.lat, geo.lng).near);
    return near ? buildPlaces(geo.lat, geo.lng, near, null) : null;
  }

  /**
   * Schools, stations, car parks, hospitals and shops around the house, from OpenStreetMap.
   * Two queries run side by side so a failure of one still leaves the other's lists. Null when both fail.
   */
  async places(geo: Geo): Promise<Places | null> {
    const q = placeQueries(geo.lat, geo.lng);
    const [near, far] = await Promise.all([this.overpass(q.near), this.overpass(q.far)]);
    return near || far ? buildPlaces(geo.lat, geo.lng, near, far) : null;
  }

  private async overpass(query: string): Promise<OsmElement[] | null> {
    for (let attempt = 0; attempt <= OVERPASS_RETRY_WAITS_MS.length; attempt++) {
      if (attempt > 0) await new Promise((done) => setTimeout(done, OVERPASS_RETRY_WAITS_MS[attempt - 1]));
      try {
        const res = await fetch(OVERPASS, {
          method: 'POST',
          body: 'data=' + encodeURIComponent(query),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          signal: AbortSignal.timeout(OVERPASS_TIMEOUT_MS),
        });
        if (res.ok) {
          const body = await res.json();
          // A query the server ran out of time on comes back as 200 with a remark and no data.
          if (Array.isArray(body.elements) && !/timed out|out of memory/i.test(body.remark ?? '')) return body.elements as OsmElement[];
        }
      } catch {
        /* busy or unreachable: try again */
      }
    }
    return null;
  }

  /** Walking and driving journeys to the nearest station, and the drive to the nearest emergency hospital (or nearest hospital). */
  async journeys(geo: Geo, places: Places): Promise<Journeys> {
    const station = places.stations[0];
    const hospital = places.emergency ?? places.hospitals[0];
    const [stationWalk, stationDrive, hospitalDrive] = await Promise.all([
      station ? this.route('foot', geo, station) : null,
      station ? this.route('car', geo, station) : null,
      hospital ? this.route('car', geo, hospital) : null,
    ]);
    return { stationWalk, stationDrive, hospitalDrive };
  }

  private async route(by: 'foot' | 'car', from: { lat: number; lng: number }, to: { lat: number; lng: number }): Promise<Route | null> {
    try {
      const profile = by === 'foot' ? 'routed-foot/route/v1/foot' : 'routed-car/route/v1/driving';
      const res = await fetch(`${ROUTING}/${profile}/${from.lng},${from.lat};${to.lng},${to.lat}?overview=false`, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) return null;
      const r = (await res.json()).routes?.[0];
      return r && r.distance > 0 ? { metres: Math.round(r.distance), minutes: Math.max(1, Math.round(r.duration / 60)) } : null;
    } catch {
      return null;
    }
  }

  /** Latest UK House Price Index figures for the council area, matched by its official area code (the index links some areas with sameAs and others with seeAlso). */
  private async hpi(geo: Geo): Promise<Hpi | null> {
    if (!/^[EW]\d{8}$/.test(geo.districtCode)) return null;
    const query = `
      PREFIX ukhpi: <http://landregistry.data.gov.uk/def/ukhpi/>
      PREFIX owl: <http://www.w3.org/2002/07/owl#>
      PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
      SELECT ?month ?avg ?chg ?terr ?semi ?det ?flat WHERE {
        ?region owl:sameAs|rdfs:seeAlso <http://statistics.data.gov.uk/id/statistical-geography/${geo.districtCode}> .
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

  private async crime(geo: Geo): Promise<CrimeSummary | null> {
    const url = `${POLICE}/crimes-street/all-crime?lat=${geo.lat}&lng=${geo.lng}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const rows = (await res.json()) as { category: string; month: string }[];
    if (!rows.length) return null;
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
    const top = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([category, count]) => ({ category: category.replace(/-/g, ' '), count }));
    const month = rows[0].month;
    // The same month a year earlier, for the direction of travel. One month alone says little.
    const earlier = `${Number(month.slice(0, 4)) - 1}${month.slice(4)}`;
    const yearAgo = await fetch(`${url}&date=${earlier}`, { signal: AbortSignal.timeout(10_000) })
      .then(async (r) => (r.ok ? ((await r.json()) as unknown[]).length : null))
      .catch(() => null);
    return { month, total: rows.length, top, burglary: counts.get('burglary') ?? 0, vehicle: counts.get('vehicle-crime') ?? 0, yearAgo };
  }

  private async flood(geo: Geo): Promise<FloodSummary | null> {
    const res = await fetch(`${FLOOD}?lat=${geo.lat}&long=${geo.lng}&dist=1`);
    if (!res.ok) return null;
    const items = ((await res.json()).items ?? []) as { label?: string; description?: string }[];
    return { areas: items.map((i) => i.label ?? i.description ?? 'Flood area').slice(0, 5) };
  }
}
