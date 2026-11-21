import { DataService } from './data.service';
import { Geo, Places } from './models';

/** A stand-in for the network: each handler answers the requests it recognises, and anything unrecognised gets a 500. */
type Reply = { ok: boolean; status: number; json: () => Promise<unknown> };
type Handler = (url: string, body: string) => Reply | Error | undefined;
const json = (data: unknown, status = 200): Reply => ({ ok: status >= 200 && status < 300, status, json: async () => data });
let calls: { url: string; body: string }[] = [];
const realFetch = globalThis.fetch;

function network(...handlers: Handler[]): void {
  calls = [];
  globalThis.fetch = (async (input: unknown, init?: { body?: unknown }) => {
    const url = String(input);
    const body = decodeURIComponent(String(init?.body ?? ''));
    calls.push({ url, body });
    for (const handle of handlers) {
      const reply = handle(url, body);
      if (reply instanceof Error) throw reply;
      if (reply) return reply;
    }
    return json({}, 500);
  }) as unknown as typeof fetch;
}
/** One row of a Land Registry answer. */
const row = (fields: Record<string, string | number>) => Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, { value: String(v) }]));
const sparql = (rows: Record<string, string | number>[]) => json({ results: { bindings: rows.map(row) } });
const on = (test: (url: string, body: string) => boolean, reply: Reply | Error): Handler => (url, body) => (test(url, body) ? reply : undefined);

const GEO: Geo = { postcode: 'PE1 2QA', outcode: 'PE1', lat: 52.58, lng: -0.24, ward: 'Park', district: 'Peterborough', districtCode: 'E06000031', country: 'England', lsoa: 'Peterborough 013G', lsoaCode: 'E01015640' };
const TYPE = 'http://landregistry.data.gov.uk/def/common/';

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.useRealTimers();
});

describe('postcodes', () => {
  it('turns a postcode into its place, ward and council area', async () => {
    network(on((u) => u.includes('/postcodes/PE12QA'), json({ result: { postcode: 'PE1 2QA', outcode: 'PE1', latitude: 52.58, longitude: -0.24, admin_ward: 'Park', admin_district: 'Peterborough', country: 'England', lsoa: 'Peterborough 013G', codes: { admin_district: 'E06000031', lsoa: 'E01015640' } } })));
    expect(await new DataService().lookupPostcode('PE1 2QA')).toEqual(GEO); // the space is taken out before asking
  });

  it('fills blanks for a postcode with little on record', async () => {
    network(on(() => true, json({ result: { postcode: 'ZZ1 1ZZ', outcode: 'ZZ1', latitude: 1, longitude: 2 } })));
    expect(await new DataService().lookupPostcode('ZZ1 1ZZ')).toMatchObject({ ward: '', district: '', districtCode: '', country: '', lsoa: '', lsoaCode: '' });
  });

  it('says so when the postcode does not exist or the service is down', async () => {
    network(on(() => true, json({}, 404)));
    await expect(new DataService().lookupPostcode('XX1 1XX')).rejects.toThrow('Postcode "XX1 1XX" was not found');
    network(on(() => true, json({}, 503)));
    await expect(new DataService().lookupPostcode('PE1 2QA')).rejects.toThrow('did not respond');
  });

  it('finds the postcodes around a house, and more of them on a wide search', async () => {
    const near = json({ result: [{ postcode: 'PE1 2QB', latitude: 52.581, longitude: -0.24 }, { postcode: 'PE1 2QA', latitude: 52.58, longitude: -0.24 }] });
    network(on((u) => u.includes('/postcodes?lon='), near));
    const narrow = await new DataService().nearbyPostcodes(GEO, false);
    expect(calls).toHaveLength(1);
    expect(narrow.get('PE1 2QA')).toBe(0);
    expect(narrow.get('PE1 2QB')).toBeGreaterThan(100);
    await new DataService().nearbyPostcodes(GEO, true);
    expect(calls).toHaveLength(1 + 5);
  });

  it('still lists the house own postcode when the lookup fails', async () => {
    network();
    expect([...(await new DataService().nearbyPostcodes(GEO, false)).entries()]).toEqual([['PE1 2QA', 0]]);
    network(on(() => true, json({})));
    expect((await new DataService().nearbyPostcodes(GEO, false)).size).toBe(1);
  });
});

describe('Land Registry sales', () => {
  const sold: Record<string, string | number>[] = [
    { paon: '24', street: 'GLEBE ROAD', postcode: 'PE1 2QA', amount: 247500, date: '2026-08-17T00:00:00', type: `${TYPE}semi-detached`, cat: `${TYPE}standardPricePaidTransaction` },
    { paon: 'FLAT 2', saon: 'A', postcode: 'PE1 2QB', amount: 90000, date: '2025-01-02', type: `${TYPE}flat-maisonette`, cat: `${TYPE}additionalPricePaidTransaction` },
    { postcode: 'PE1 9ZZ', amount: 1, date: '2020-01-01', type: `${TYPE}somethingNew` },
  ];

  it('reads sales with their type, category and distance', async () => {
    network(on((_, b) => b.includes('lrppi:pricePaid'), sparql(sold)));
    const sales = await new DataService().sales(new Map([['PE1 2QA', 0], ['PE1 2QB', 120]]), '2024-11-21');
    expect(sales[0]).toEqual({ paon: '24', saon: '', street: 'GLEBE ROAD', postcode: 'PE1 2QA', price: 247500, date: '2026-08-17', type: 'semi-detached', standard: true, distanceM: 0 });
    expect(sales[1]).toMatchObject({ saon: 'A', type: 'flat-maisonette', standard: false, distanceM: 120 });
    expect(sales[2]).toMatchObject({ paon: '', street: '', type: 'other', standard: true, distanceM: null });
    expect(calls[0].body).toContain('FILTER(?date >= "2024-11-21"');
    expect(calls[0].body).toContain('"PE1 2QA" "PE1 2QB"');
  });

  it('asks for the whole history when no start date is given, and fails loudly when the registry is down', async () => {
    network(on(() => true, sparql([])));
    expect(await new DataService().sales(new Map([['PE1 2QA', 0]]), null)).toEqual([]);
    expect(calls[0].body).not.toContain('FILTER(?date');
    network();
    await expect(new DataService().sales(new Map([['PE1 2QA', 0]]), null)).rejects.toThrow('HM Land Registry did not respond');
  });

  it('finds every sale on a street by postcode district', async () => {
    network(on((_, b) => b.includes('lrcommon:street "BURGHLEY ROAD"'), sparql([{ paon: '15A', postcode: 'PE1 2QA', amount: 105000, date: '2025-09-12', type: `${TYPE}terraced` }])));
    const sales = await new DataService().streetSales('Burghley Road.', 'pe1', []);
    expect(sales).toEqual([{ paon: '15A', saon: '', street: 'BURGHLEY ROAD', postcode: 'PE1 2QA', price: 105000, date: '2025-09-12', type: 'terraced', standard: true, distanceM: null }]);
    expect(calls[0].body).toContain('FILTER(STRSTARTS(?postcode, "PE1 "))');
  });

  it('tries each town in turn when there is no postcode district, and gives up quietly', async () => {
    network(
      on((_, b) => b.includes('lrcommon:town "CAMBRIDGESHIRE"'), json({}, 500)),
      on((_, b) => b.includes('lrcommon:town "PETERBOROUGH"'), sparql([{ postcode: 'PE1 2QA', amount: 1, date: '2020-01-01', type: `${TYPE}weird` }])),
    );
    const sales = await new DataService().streetSales('Burghley Road', null, ['Cambridgeshire', 'Peterborough']);
    expect(sales).toHaveLength(1);
    expect(sales[0]).toMatchObject({ paon: '', type: 'other' });
    expect(calls).toHaveLength(2);
    network(on(() => true, sparql([])));
    expect(await new DataService().streetSales('Nowhere Lane', null, ['A', 'B', 'C', 'D'])).toEqual([]);
    expect(calls).toHaveLength(3); // no more than three towns are tried
    expect(await new DataService().streetSales('!!!', 'PE1', [])).toEqual([]);
    expect(calls).toHaveLength(3);
  });
});

describe('price index', () => {
  const service = () => new DataService();

  it('measures how far prices of a property type have moved since a month', async () => {
    network(on((_, b) => b.includes('housePriceIndexSemiDetached'), sparql([{ month: '2026-08', all: 100.8, typed: 102.4 }, { month: '2026-09', all: 100.6, typed: 102.2 }])));
    expect(await service().priceMove(GEO, 'semi-detached', '2026-08')).toBeCloseTo(102.2 / 102.4, 6);
    expect(calls[0].body).toContain('owl:sameAs|rdfs:seeAlso');
  });

  it('uses the all-homes index when the type has none', async () => {
    network(on(() => true, sparql([{ month: '2026-08', all: 100 }, { month: '2026-09', all: 103 }])));
    expect(await service().priceMove(GEO, 'other', '2026-08')).toBeCloseTo(1.03, 6);
  });

  it('gives no figure when it cannot be measured from the month of the sale', async () => {
    network(on(() => true, sparql([{ month: '2026-09', all: 100 }])));
    expect(await service().priceMove(GEO, 'terraced', '2026-08')).toBeNull(); // index starts later than the sale
    network(on(() => true, sparql([])));
    expect(await service().priceMove(GEO, 'terraced', '2026-10')).toBeNull(); // sale newer than the index
    network();
    expect(await service().priceMove(GEO, 'terraced', '2026-08')).toBeNull(); // service down
    network(on(() => true, sparql([{ month: '2026-08', all: 0 }, { month: '2026-09', all: 100 }])));
    expect(await service().priceMove(GEO, 'terraced', '2026-08')).toBeNull(); // nonsense index
    calls = [];
    expect(await service().priceMove({ ...GEO, districtCode: 'S12000033' }, 'terraced', '2026-08')).toBeNull(); // Scotland is not covered
    expect(await service().priceMove(GEO, 'terraced', 'last August')).toBeNull();
    expect(calls).toHaveLength(0);
  });
});

describe('area context', () => {
  const crimes = (n: number, category = 'violent-crime', month = '2026-09') => Array.from({ length: n }, () => ({ category, month }));

  it('summarises crime, flood areas and the price index', async () => {
    network(
      on((u) => u.includes('crimes-street') && u.includes('date=2025-09'), json(crimes(5))),
      on((u) => u.includes('crimes-street'), json([...crimes(3), ...crimes(2, 'burglary'), ...crimes(1, 'vehicle-crime'), ...crimes(1, 'anti-social-behaviour'), ...crimes(1, 'drugs'), ...crimes(1, 'robbery')])),
      on((u) => u.includes('flood-monitoring'), json({ items: [{ label: 'Lower Nene' }, { description: 'Fens' }, {}] })),
      on((_, b) => b.includes('percentageAnnualChange'), sparql([{ month: '2026-09', avg: 232703, chg: -1.3, terr: 189266, semi: 240000, det: 380000, flat: 110000 }])),
    );
    const area = await new DataService().area(GEO);
    expect(area.crime).toEqual({ month: '2026-09', total: 9, top: [{ category: 'violent crime', count: 3 }, { category: 'burglary', count: 2 }, { category: 'vehicle crime', count: 1 }, { category: 'anti social behaviour', count: 1 }], burglary: 2, vehicle: 1, yearAgo: 5 });
    expect(area.flood).toEqual({ areas: ['Lower Nene', 'Fens', 'Flood area'] });
    expect(area.hpi).toEqual({ month: '2026-09', average: 232703, annualChangePct: -1.3, byType: { terraced: 189266, 'semi-detached': 240000, detached: 380000, 'flat-maisonette': 110000 } });
  });

  it('leaves out whichever source fails, without losing the others', async () => {
    network(on((u) => u.includes('flood-monitoring'), json({})));
    expect(await new DataService().area(GEO)).toEqual({ crime: null, flood: { areas: [] }, hpi: null });
    network(on((u) => u.includes('crimes-street'), json([])), on((_, b) => b.includes('percentageAnnualChange'), sparql([])));
    expect(await new DataService().area(GEO)).toEqual({ crime: null, flood: null, hpi: null });
    network(on(() => true, new Error('offline')));
    expect(await new DataService().area(GEO)).toEqual({ crime: null, flood: null, hpi: null });
  });

  it('copes with a missing year-ago crime figure and a bare price index', async () => {
    network(
      on((u) => u.includes('date='), json({}, 500)),
      on((u) => u.includes('crimes-street'), json(crimes(2))),
      on((_, b) => b.includes('percentageAnnualChange'), sparql([{ month: '2026-09-01', avg: 200000 }])),
    );
    const area = await new DataService().area({ ...GEO });
    expect(area.crime).toMatchObject({ total: 2, burglary: 0, vehicle: 0, yearAgo: null });
    expect(area.hpi).toEqual({ month: '2026-09', average: 200000, annualChangePct: null, byType: {} });
    expect((await new DataService().area({ ...GEO, districtCode: '' })).hpi).toBeNull();
  });
});

describe('demand figures', () => {
  const hpi = sparql([
    { month: '2026-08', avg: 230000, idx: 100, terr: 99, semi: 101, det: 98, flat: 93, vol: 140, nb: 2 },
    { month: '2026-08', avg: 230000, idx: 100, terr: 99, semi: 101, det: 98, flat: 93, vol: 140, nb: 2 }, // an area linked twice comes back twice
    { month: '2026-09', avg: 232000, idx: 101 },
  ]);
  const obs = (code: string, time: string, value: number | null) => ({ geography: { geogcode: code }, time: { value: time }, obs_value: { value } });
  const nomis = (dataset: string, values: [string, string, number | null][]) => on((u) => u.includes(`${dataset}.data.json`), json({ obs: values.map((v) => obs(...v)) }));
  const all: Handler[] = [
    on((_, b) => b.includes('ukhpi:salesVolume'), hpi),
    nomis('NM_2002_1', [['E06000031', '2025', 224757], ['E06000031', '2020', 213718], ['E92000001', '2020', 56000000], ['E92000001', '2025', 58800000]]),
    nomis('NM_99_1', [['E06000031', '2020', 29873], ['E06000031', '2025', 36050], ['E92000001', '2025', 39298], ['E06000031', '2024', null]]),
    nomis('NM_162_1', [['E06000031', '2025-10', 5.3], ['E06000031', '2026-10', 5.4], ['E92000001', '2026-10', 4.1]]),
  ];

  it('gathers prices, sales, population, earnings and claimants for the area and its country', async () => {
    network(...all);
    const d = (await new DataService().demand(GEO))!;
    expect(d.areaName).toBe('Peterborough');
    expect(d.countryName).toBe('England');
    expect(d.area.hpi).toEqual([
      { month: '2026-08', average: 230000, index: 100, byType: { terraced: 99, 'semi-detached': 101, detached: 98, 'flat-maisonette': 93 }, sales: 140, newBuild: 2 },
      { month: '2026-09', average: 232000, index: 101, byType: {}, sales: null, newBuild: null },
    ]);
    expect(d.area.population).toEqual([[2020, 213718], [2025, 224757]]); // oldest first, whatever order they arrive in
    expect(d.area.earnings).toEqual([[2020, 29873], [2025, 36050]]); // a suppressed figure is left out
    expect(d.area.claimants).toEqual([['2025-10', 5.3], ['2026-10', 5.4]]);
    expect(d.country.population).toEqual([[2020, 56000000], [2025, 58800000]]);
    expect(calls.filter((c) => c.url.includes('nomisweb')).every((c) => c.url.includes('geography=E06000031,E92000001'))).toBe(true);
  });

  it('asks once for each council area, however many houses are analysed there', async () => {
    network(...all);
    const service = new DataService();
    await service.demand(GEO);
    const asked = calls.length;
    await service.demand({ ...GEO, postcode: 'PE1 5HW' });
    expect(calls).toHaveLength(asked);
  });

  it('keeps what it can when a source is down, and tries again later if nothing came back', async () => {
    network(on((_, b) => b.includes('ukhpi:salesVolume'), hpi), on((u) => u.includes('nomisweb'), new Error('offline')));
    const partial = (await new DataService().demand(GEO))!;
    expect(partial.area.hpi).toHaveLength(2);
    expect(partial.area.population).toEqual([]);
    network(on((u) => u.includes('NM_2002_1'), json({})));
    const service = new DataService();
    const empty = (await service.demand(GEO))!;
    expect(empty.area.hpi).toEqual([]);
    await Promise.resolve();
    const asked = calls.length;
    await service.demand(GEO);
    expect(calls.length).toBeGreaterThan(asked); // nothing useful was kept, so it asked again
  });

  it('covers Wales, and nowhere else', async () => {
    network(...all);
    expect((await new DataService().demand({ ...GEO, country: 'Wales', districtCode: 'W06000015', district: 'Cardiff' }))!.countryName).toBe('Wales');
    expect(calls.some((c) => c.body.includes('/id/region/wales'))).toBe(true);
    expect(await new DataService().demand({ ...GEO, country: 'Scotland' })).toBeNull();
    expect(await new DataService().demand({ ...GEO, districtCode: '' })).toBeNull();
  });
});

describe('places around a house', () => {
  const school = ['110723', "Queen's Drive Infant School", 52.5827, -0.24, 'P', 'community school', 5, 7, 208, '', 0, '', ['O', '2023-10', 2, '', 0]];
  const files: Handler[] = [
    on((u) => u.includes('data/places/schools/105_-1.json'), json([school])),
    on((u) => u.includes('data/places/stations.json'), json([['Peterborough', 52.5747, -0.2497, 'R']])),
    on((u) => u.includes('data/places/hospitals.json'), json([['Peterborough City Hospital', 52.5839, -0.2787, 'N', 1, 0]])),
    on((u) => u.includes('data/places/meta.json'), json({ schoolsDate: '2026-11-20', ofstedAsAt: '31 October 2026' })),
  ];
  const mapAnswer = json({ elements: [{ lat: 52.5812, lon: -0.24, tags: { amenity: 'doctors', name: 'Park Medical Centre' } }, { lat: 52.5805, lon: -0.24, tags: { highway: 'bus_stop' } }] });

  it('reads schools, stations and hospitals from the files that ship with the app', async () => {
    network(...files);
    const service = new DataService();
    const p = (await service.officialPlaces(GEO))!;
    expect(p.official).toBe(true);
    expect(p.schools.map((s) => [s.name, s.ofsted?.text])).toEqual([["Queen's Drive Infant School", 'Good']]);
    expect(p.schoolCount).toBe(1);
    expect(p.stations[0]).toMatchObject({ name: 'Peterborough', kind: 'Rail' });
    expect(p.emergency?.name).toBe('Peterborough City Hospital');
    expect([p.farOk, p.nearOk, p.carParks.length]).toEqual([true, false, 0]);
    const asked = calls.length;
    await service.officialPlaces(GEO);
    expect(calls).toHaveLength(asked); // each file is read once a visit
    expect(await service.placesMeta()).toEqual({ schoolsDate: '2026-11-20', ofstedAsAt: '31 October 2026' });
  });

  it('treats a square with no school file as no schools, and reports a broken file as a failure', async () => {
    network(on((u) => u.includes('/schools/'), json({}, 404)), ...files.slice(1));
    expect((await new DataService().officialPlaces(GEO))!.schools).toEqual([]);
    network(...files.slice(0, 2));
    expect(await new DataService().officialPlaces(GEO)).toBeNull();
    expect(await new DataService().placesMeta()).toBeNull();
  });

  it('adds car parks, GPs and bus stops from the map server', async () => {
    network(on((u) => u.includes('overpass'), mapAnswer));
    const extras = (await new DataService().nearbyExtras(GEO))!;
    expect([extras.nearOk, extras.doctors[0].name, extras.busStops]).toEqual([true, 'Park Medical Centre', 1]);
    expect(calls[0].body).toContain('amenity=parking');
  });

  it('waits and tries the map server again when it refuses', async () => {
    vi.useFakeTimers();
    let attempts = 0;
    network((u) => (u.includes('overpass') ? (++attempts < 3 ? json({}, 502) : mapAnswer) : undefined));
    const pending = new DataService().nearbyExtras(GEO);
    await vi.advanceTimersByTimeAsync(6000);
    expect((await pending)!.busStops).toBe(1);
    expect(attempts).toBe(3);
  });

  it('gives up on the map server after three tries, including when it runs out of time', async () => {
    vi.useFakeTimers();
    network(on((u) => u.includes('overpass'), json({ elements: [], remark: 'runtime error: Query timed out in "query" at line 1' })));
    const timedOut = new DataService().nearbyExtras(GEO);
    await vi.advanceTimersByTimeAsync(6000);
    expect(await timedOut).toBeNull();
    expect(calls).toHaveLength(3);
    network(on(() => true, new Error('offline')));
    const offline = new DataService().places(GEO);
    await vi.advanceTimersByTimeAsync(6000);
    expect(await offline).toBeNull();
  });

  it('reads everything from the map when asked to', async () => {
    network(on((u, b) => u.includes('overpass') && b.includes('railway=station'), json({ elements: [{ lat: 52.5747, lon: -0.2497, tags: { railway: 'station', name: 'Peterborough' } }] })), on((u) => u.includes('overpass'), mapAnswer));
    const p = (await new DataService().places(GEO))!;
    expect([p.official, p.nearOk, p.farOk, p.stations[0].name, p.busStops]).toEqual([false, true, true, 'Peterborough', 1]);
  });
});

describe('journeys', () => {
  const places = { stations: [{ name: 'Peterborough', lat: 52.5747, lng: -0.2497, distanceM: 900, kind: 'Rail' }], hospitals: [{ name: 'City Care Centre', lat: 52.59, lng: -0.25, distanceM: 1500, emergency: false }], emergency: null } as unknown as Places;
  const route = (distance: number, duration: number) => json({ routes: [{ distance, duration }] });

  it('gives the walk and the drive to the station, and the drive to the hospital', async () => {
    network(on((u) => u.includes('routed-foot'), route(1895.4, 1518)), on((u) => u.includes('routed-car') && u.includes('-0.2497'), route(2488, 288)), on((u) => u.includes('routed-car'), route(4800, 20)));
    expect(await new DataService().journeys(GEO, places)).toEqual({ stationWalk: { metres: 1895, minutes: 25 }, stationDrive: { metres: 2488, minutes: 5 }, hospitalDrive: { metres: 4800, minutes: 1 } });
    expect(calls[0].url).toContain('/-0.24,52.58;-0.2497,52.5747');
  });

  it('prefers the emergency department, and leaves out a journey that cannot be found', async () => {
    network(on((u) => u.includes('routed-foot'), json({}, 500)), on((u) => u.includes('-0.2787'), route(4800, 540)), on((u) => u.includes('routed-car'), json({ routes: [{ distance: 0, duration: 0 }] })));
    const withEmergency = { ...places, emergency: { name: 'Peterborough City Hospital', lat: 52.5839, lng: -0.2787, distanceM: 3600, emergency: true } } as unknown as Places;
    expect(await new DataService().journeys(GEO, withEmergency)).toEqual({ stationWalk: null, stationDrive: null, hospitalDrive: { metres: 4800, minutes: 9 } });
    network(on(() => true, new Error('offline')));
    expect(await new DataService().journeys(GEO, places)).toEqual({ stationWalk: null, stationDrive: null, hospitalDrive: null });
    calls = [];
    expect(await new DataService().journeys(GEO, { stations: [], hospitals: [], emergency: null } as unknown as Places)).toEqual({ stationWalk: null, stationDrive: null, hospitalDrive: null });
    expect(calls).toHaveLength(0);
  });
});
