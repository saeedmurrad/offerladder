import { ComponentFixture, TestBed } from '@angular/core/testing';
import { App } from './app';
import { DataService } from './data.service';
import { AreaData, DemandData, Geo, Journeys, Places, Sale, School } from './models';
import { buildPlaces } from './places';

/** yyyy-mm-dd a number of days before today, so the tests do not go stale as the calendar moves. */
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const GEO: Geo = { postcode: 'PE1 2QA', outcode: 'PE1', lat: 52.58, lng: -0.24, ward: 'Park', district: 'Peterborough', districtCode: 'E06000031', country: 'England', lsoa: 'Peterborough 013G', lsoaCode: 'E01015640' };
const sale = (paon: string, price: number, date: string, type: Sale['type'] = 'terraced', postcode = 'PE1 2QB'): Sale => ({ paon, saon: '', street: 'BURGHLEY ROAD', postcode, price, date, type, standard: true, distanceM: 120 });

/** Ten terraced sales and five semi-detached, with one freak price among the terraced. */
const NEARBY: Sale[] = [
  ...[118_000, 122_000, 125_000, 128_000, 130_000, 132_000, 135_000, 138_000, 142_000].map((p, n) => sale(`${n + 1}`, p, daysAgo(60 + n * 30))),
  sale('99', 900_000, daysAgo(90)),
  ...[230_000, 240_000, 245_000, 250_000, 260_000].map((p, n) => sale(`${n + 40}`, p, daysAgo(80 + n * 40), 'semi-detached')),
];
/** The house's own record: a semi-detached bought three months ago. */
const OWN: Sale[] = [sale('24', 247_500, daysAgo(95), 'semi-detached', 'PE1 2QA'), sale('24', 154_000, '2010-08-09', 'semi-detached', 'PE1 2QA'), sale('7', 111_000, daysAgo(400), 'terraced', 'PE1 2QA')];
const AREA: AreaData = { crime: { month: '2026-09', total: 615, top: [{ category: 'violent crime', count: 209 }], burglary: 15, vehicle: 30, yearAgo: 539 }, flood: { areas: ['Lower Nene', 'Fens'] }, hpi: { month: '2026-09', average: 232_703, annualChangePct: -1.3, byType: { terraced: 189_266, 'semi-detached': 240_000 } } };
const school = (name: string, weak: boolean): School => ({ name, lat: 52.581, lng: -0.24, distanceM: 400, urn: '110723', phase: 'Primary', ages: 'ages 5 to 7', kind: 'community school', independent: false, pupils: 208, gender: '', selective: false, faith: '', ofsted: { text: weak ? 'Requires improvement' : 'Good', inspected: 'Oct 2023', concern: '', weak, former: false }, wales: false });
const OFFICIAL: Places = { ...buildPlaces(GEO.lat, GEO.lng, null, null), official: true, farOk: true, schools: [school('Good Primary', false), { ...school('Weak Primary', true), urn: '110724' }], schoolCount: 2, stations: [{ name: 'Peterborough', lat: 52.5747, lng: -0.2497, distanceM: 900, kind: 'Rail' }], hospitals: [], emergency: { name: 'City Hospital', lat: 52.58, lng: -0.27, distanceM: 3600, emergency: true } };
const EXTRAS: Places = { ...buildPlaces(GEO.lat, GEO.lng, [{ lat: 52.5805, lon: -0.24, tags: { highway: 'bus_stop' } }, { lat: 52.582, lon: -0.24, tags: { amenity: 'parking', name: 'Brook Street Car Park', fee: 'yes' } }], null) };
const JOURNEYS: Journeys = { stationWalk: { metres: 1100, minutes: 14 }, stationDrive: { metres: 1500, minutes: 4 }, hospitalDrive: { metres: 4800, minutes: 9 } };
const month = (n: number) => `${2019 + Math.floor((n + 6) / 12)}-${String(((n + 6) % 12) + 1).padStart(2, '0')}`;
/** Seven years of figures for an area. The country grows slowly and builds plenty; the test area grows fast and builds little. */
const series = (growth: number, average: number, newBuild: number, population: number, pay: number, claimants: number) => ({
  hpi: Array.from({ length: 84 }, (_, n) => ({ month: month(n), average, index: 100 * Math.pow(growth, n / 12), byType: {}, sales: n >= 82 ? null : 200, newBuild: n >= 82 ? null : newBuild })),
  population: [[2020, 200_000], [2025, population]] as [number, number][],
  earnings: [[2020, 30_000], [2025, pay]] as [number, number][],
  claimants: [['2025-10', 4.5], ['2026-10', claimants]] as [string, number][],
});
const DEMAND: DemandData = { areaName: 'Peterborough', countryName: 'England', area: series(1.05, 230_000, 10, 212_000, 40_000, 4.0), country: series(1.02, 300_000, 40, 205_000, 34_000, 4.5) };

function fakeData() {
  return {
    lookupPostcode: vi.fn(async (postcode: string): Promise<Geo> => ({ ...GEO, postcode: postcode.toUpperCase() })),
    nearbyPostcodes: vi.fn(async () => new Map([['PE1 2QA', 0], ['PE1 2QB', 120]])),
    sales: vi.fn(async (_: Map<string, number>, since: string | null) => (since ? NEARBY : OWN)),
    streetSales: vi.fn(async (): Promise<Sale[]> => []),
    priceMove: vi.fn(async (): Promise<number | null> => 1.02),
    demand: vi.fn(async (): Promise<DemandData | null> => DEMAND),
    area: vi.fn(async () => AREA),
    officialPlaces: vi.fn(async (): Promise<Places | null> => OFFICIAL),
    nearbyExtras: vi.fn(async (): Promise<Places | null> => EXTRAS),
    places: vi.fn(async (): Promise<Places | null> => null),
    journeys: vi.fn(async () => JOURNEYS),
    placesMeta: vi.fn(async () => ({ schoolsDate: '2026-11-20', ofstedAsAt: '31 October 2026' })),
  };
}
type Fake = ReturnType<typeof fakeData>;

let data: Fake;
let fixture: ComponentFixture<App>;
let app: App;

/** Lets the background lookups (area, places, journeys, demand) finish and the page redraw. */
async function settle(): Promise<void> {
  for (let n = 0; n < 6; n++) await new Promise((done) => setTimeout(done, 0));
  fixture.detectChanges();
  await fixture.whenStable();
}
function start(): void {
  data = fakeData();
  TestBed.configureTestingModule({ imports: [App], providers: [{ provide: DataService, useValue: data }] });
  fixture = TestBed.createComponent(App);
  app = fixture.componentInstance;
  fixture.detectChanges();
}
async function analyse(house: Partial<App extends { inputs: () => infer I } ? I : never> = { houseNumber: '24', postcode: 'pe1 2qa' }): Promise<void> {
  app.inputs.update((i) => ({ ...i, ...house }));
  await app.analyse();
  await settle();
}
const text = () => (fixture.nativeElement as HTMLElement).textContent ?? '';
const event = (value: string | boolean) => ({ target: typeof value === 'boolean' ? { checked: value } : { value }, preventDefault: () => undefined }) as unknown as Event;

/** The test runner's own localStorage is an empty shell, so the tests bring a small one that works. */
function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key: string) => items.get(key) ?? null,
    key: (n: number) => [...items.keys()][n] ?? null,
    removeItem: (key: string) => void items.delete(key),
    setItem: (key: string, value: string) => void items.set(key, String(value)),
  };
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true });
  location.hash = '';
  window.scrollTo = (() => undefined) as typeof window.scrollTo;
});

describe('analysing a house', () => {
  beforeEach(start);

  it('opens on the welcome screen and asks for a postcode before it will analyse', async () => {
    expect(text()).toContain('Know what to offer');
    await app.analyse(event(''));
    expect([app.status(), app.error()]).toEqual(['error', 'Enter the postcode of the house.']);
    fixture.detectChanges();
    expect(text()).toContain('Could not analyse this house');
  });

  it('values the house on its own recent sale, against the right kind of neighbour', async () => {
    await analyse();
    expect(app.status()).toBe('done');
    expect(app.inputs().postcode).toBe('PE1 2QA');
    // Land Registry records it as semi-detached, so it is not compared with terraced houses.
    expect(app.inputs().propertyType).toBe('semi-detached');
    expect(app.typeNote()).toContain('Type changed from Terraced to Semi-detached');
    expect(app.comps().map((c) => c.type)).toEqual(Array(5).fill('semi-detached'));
    expect(app.history()).toHaveLength(2);
    expect(app.own()).toMatchObject({ paid: 247_500, movePct: expect.closeTo(2, 5) });
    expect(app.value()!.mid).toBeGreaterThan(245_000);
    expect(app.ladder()!.open).toBeGreaterThan(210_000);
    expect(app.seller()).toMatchObject({ paid: 247_500 });
    expect(data.priceMove).toHaveBeenCalledWith(expect.anything(), 'semi-detached', OWN[0].date.slice(0, 7));
    expect(text()).toMatch(/24\s+PE1 2QA/);
    expect(text()).toContain('In short');
  });

  it('fills in the area, the places around the house, the journeys and the demand outlook', async () => {
    await analyse();
    expect(app.area()).toBe(AREA);
    expect(app.places()).toMatchObject({ official: true, nearOk: true, busStops: 1 });
    expect([app.placesState(), app.extrasState(), app.areaLoading(), app.demandLoading()]).toEqual(['done', 'done', false, false]);
    expect(app.journeys()).toBe(JOURNEYS);
    expect(app.outlook()!.verdict).toBe('building');
    expect(app.placesMeta()).toMatchObject({ ofstedAsAt: '31 October 2026' });
    const lines = app.summary().map((p) => p.text).join(' | ');
    for (const part of ['Peterborough station is 14 minutes on foot', '2 schools within a mile, 1 with a good or better', 'Demand in Peterborough is building', 'flood alert areas', '14% higher than a year ago']) expect(lines).toContain(part);
    for (const part of ['Peterborough station', '14 minutes on foot', 'Good Primary', 'Brook Street Car Park', 'Demand pressure is building', 'What to do next']) expect(text()).toContain(part);
  });

  it('keeps the type you chose when you analyse the same house again', async () => {
    await analyse();
    app.set('propertyType', 'terraced');
    expect(app.typeNote()).toBe('');
    expect(app.comps().every((c) => c.type === 'terraced')).toBe(true);
    expect(app.comps().find((c) => c.price === 900_000)!.selected).toBe(false); // the freak price starts unticked
    await analyse({});
    expect(app.inputs().propertyType).toBe('terraced');
    expect(app.evidenceGap()).toBeLessThan(-15); // terraced neighbours sit far below what this house sold for
    fixture.detectChanges();
    expect(text()).toContain('Nearby sales and this house disagree');
  });

  it('works without a house number, on nearby sales alone', async () => {
    await analyse({ houseNumber: '', postcode: 'PE1 2QA', asking: 150_000, rentPcm: 900, listedDate: daysAgo(80), bedrooms: 2 });
    expect([app.history().length, app.own(), app.typeNote()]).toEqual([0, null, '']);
    expect(data.priceMove).not.toHaveBeenCalled();
    expect(app.value()).toMatchObject({ basis: 'sizeAdjusted', own: null });
    expect(app.areaAssumed()).toBe(true);
    expect(app.stance()).toBe('above'); // £150,000 is more than two-bed terraced sales nearby support
    expect(app.daysListed()).toBe(80);
    expect(app.returns().map((r) => r.label)).toEqual(['Open', 'Target', 'Maximum', 'Asking']);
    expect(app.targetReturn()!.r.grossYield).toBeGreaterThan(5);
    expect(app.yieldPrice()).toBeGreaterThan(50_000);
    expect(app.duty()[0]).toMatchObject({ label: 'Open' });
    expect(app.sector()).toBe('PE1 2');
    expect(app.links()).toMatchObject({ rent: 'https://www.zoopla.co.uk/to-rent/property/pe1/', localHousing: 'https://www.ons.gov.uk/visualisations/housingpriceslocal/E06000031/' });
    expect(app.calculatorPrice()).toBe(app.ladder()!.target);
    expect(app.calculatorLabel()).toBe('the "aim for" price of PE1 2QA');
    expect(app.vsAsking(135_000)).toBe('-10% vs asking');
    expect(text()).toContain('Rough estimate: floor area assumed');
  });

  it('explains what went wrong when the house cannot be analysed', async () => {
    data.lookupPostcode.mockResolvedValueOnce({ ...GEO, postcode: 'EH1 1YZ', country: 'Scotland' });
    await analyse({ postcode: 'EH1 1YZ' });
    expect(app.error()).toBe('Land Registry price data covers England and Wales only. EH1 1YZ is in Scotland.');
    data.lookupPostcode.mockRejectedValueOnce(new Error('Postcode "XX" was not found.'));
    await analyse({ postcode: 'XX' });
    expect(app.error()).toBe('Postcode "XX" was not found.');
    data.sales.mockRejectedValueOnce('boom');
    await analyse({ postcode: 'PE1 2QA' });
    expect([app.status(), app.error()]).toEqual(['error', 'Something went wrong while loading the data.']);
  });

  it('uses the sale price as it stands when the index cannot be read', async () => {
    data.priceMove.mockRejectedValueOnce(new Error('offline'));
    await analyse();
    expect(app.own()).toMatchObject({ movePct: null, indexed: 247_500 });
  });

  it('brings the report into view on a phone', async () => {
    const width = window.innerWidth;
    const scrolled = vi.fn();
    Object.defineProperty(window, 'innerWidth', { value: 400, configurable: true });
    Element.prototype.scrollIntoView = scrolled;
    try {
      await analyse();
      await new Promise((done) => setTimeout(done, 80));
      expect(scrolled).toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
    }
  });
});

describe('places and area that arrive late or not at all', () => {
  beforeEach(start);

  it('falls back to the map when the bundled files cannot be read', async () => {
    data.officialPlaces.mockResolvedValue(null);
    data.places.mockResolvedValue({ ...EXTRAS, farOk: true, stations: OFFICIAL.stations });
    await analyse();
    expect(app.places()).toMatchObject({ official: false, nearOk: true });
    expect([app.placesState(), app.extrasState()]).toEqual(['done', 'done']);
  });

  it('says so when nothing about the places could be found, and can try again', async () => {
    data.officialPlaces.mockResolvedValue(null);
    data.places.mockRejectedValue(new Error('offline'));
    await analyse();
    expect([app.places(), app.placesState(), app.extrasState()]).toEqual([null, 'failed', 'failed']);
    expect(text()).toContain('could not be looked up');
    data.officialPlaces.mockResolvedValue(OFFICIAL);
    app.retryPlaces();
    await settle();
    expect(app.placesState()).toBe('done');
  });

  it('keeps the schools and stations when only the map server is down', async () => {
    data.nearbyExtras.mockRejectedValue(new Error('502'));
    data.journeys.mockRejectedValue(new Error('offline'));
    await analyse();
    expect([app.placesState(), app.extrasState(), app.places()!.nearOk, app.journeys()]).toEqual(['done', 'failed', false, null]);
    expect(text()).toContain('The map server did not answer');
  });

  it('ignores answers that arrive after another house has been analysed', async () => {
    let releasePlaces: (p: Places) => void = () => undefined;
    data.officialPlaces.mockImplementationOnce(() => new Promise<Places>((r) => (releasePlaces = r)));
    let releaseArea: (a: AreaData) => void = () => undefined;
    data.area.mockImplementationOnce(() => new Promise<AreaData>((r) => (releaseArea = r)));
    let releaseDemand: (d: DemandData) => void = () => undefined;
    data.demand.mockImplementationOnce(() => new Promise<DemandData>((r) => (releaseDemand = r)));
    await analyse();
    data.lookupPostcode.mockResolvedValueOnce({ ...GEO, postcode: 'CF10 1AA', outcode: 'CF10', district: 'Cardiff', districtCode: 'W06000015', country: 'Wales' });
    data.area.mockResolvedValueOnce({ crime: null, flood: null, hpi: null });
    data.demand.mockResolvedValueOnce(null);
    await analyse({ houseNumber: '1', postcode: 'CF10 1AA' });
    releasePlaces({ ...OFFICIAL, schoolCount: 99 });
    releaseArea({ ...AREA, flood: { areas: ['stale'] } });
    releaseDemand({ ...DEMAND, areaName: 'stale' });
    await settle();
    expect(app.places()?.schoolCount).toBe(2);
    expect(app.area()).toEqual({ crime: null, flood: null, hpi: null });
    expect(app.demand()).toBeNull();
    expect(app.outlook()).toBeNull();
    expect(app.links()!.rent).toContain('/cf10/');
  });
});

describe('comparables', () => {
  beforeEach(async () => {
    start();
    await analyse({ houseNumber: '', postcode: 'PE1 2QA', floorArea: 70 });
  });

  it('lets a sale be ticked out and given a floor area', () => {
    const first = app.comps()[0];
    app.toggleComp(first.id);
    expect(app.comps()[0].selected).toBe(false);
    expect(app.selectedCount()).toBe(8);
    app.setCompArea(first.id, event('71'));
    expect(app.comps()[0].m2).toBe(71);
    expect(app.withAreaCount()).toBe(0); // it is still unticked
  });

  it('reads floor areas from pasted rows and can keep only houses of a similar size', () => {
    app.applyPaste();
    expect(app.pasteNote()).toContain('No floor areas found');
    app.pasteText.set(['1 PE1 2QB 68 m2', '2 PE1 2QB 72 m2', '3 PE1 2QB 70 m2', '4 PE1 2QB 69 m2', '5 PE1 2QB 140 m2', '77 ZZ1 1ZZ 50 m2'].join('\n'));
    app.applyPaste();
    expect(app.pasteNote()).toBe('6 rows read, 5 matched to the comparables below.');
    expect(app.value()!.basis).toBe('perM2');
    app.keepSimilarSize();
    expect(app.comps().filter((c) => c.selected).map((c) => c.m2)).toEqual([68, 72, 70, 69]);
    fixture.detectChanges();
    expect(text()).toContain('per m²');
  });

  it('gives no offer with fewer than three sales, and does nothing odd without a floor area', () => {
    for (const c of app.comps().slice(2)) if (c.selected) app.toggleComp(c.id);
    expect([app.value(), app.ladder(), app.stance(), app.evidenceGap()]).toEqual([null, null, null, null]);
    fixture.detectChanges();
    expect(text()).toContain('Fewer than three comparable sales are ticked');
    app.set('floorArea', null);
    app.set('bedrooms', null);
    const before = app.comps();
    app.keepSimilarSize();
    expect(app.comps()).toBe(before);
  });
});

describe('comparing houses', () => {
  beforeEach(start);

  it('saves, updates, opens and removes houses, up to three', async () => {
    app.saveCurrent(); // nothing analysed yet
    expect(app.saved()).toEqual([]);
    await analyse({ houseNumber: '24', street: 'Glebe Road', postcode: 'PE1 2QA', asking: 250_000, rentPcm: 1100, useMortgage: true });
    expect(app.isSaved()).toBe(false);
    app.saveCurrent();
    expect(app.saveNote()).toContain('Analyse another house');
    expect(app.saved()[0]).toMatchObject({ id: 'PE1 2QA|24', label: '24 Glebe Road, PE1 2QA', district: 'Peterborough', sellerPaid: 247_500, crimeTotal: 615, floodAreas: 2, stationM: 900 });
    expect(app.saved()[0].netYieldAtTarget).toBeGreaterThan(0);
    expect(app.isSaved()).toBe(true);
    app.saveCurrent();
    expect(app.saveNote()).toBe('Comparison updated with the current figures.');

    for (const [n, postcode] of ['PE1 2QB', 'PE1 2QE'].entries()) {
      await analyse({ houseNumber: '', street: '', postcode, rentPcm: null, useMortgage: false });
      app.saveCurrent();
      expect(app.saveNote()).toContain(`${n + 2} houses are ready to compare`);
    }
    expect(app.saved()[1]).toMatchObject({ label: 'PE1 2QB', netYieldAtTarget: null, netIncome: null, sellerPaid: null });
    await analyse({ postcode: 'PE1 2QF' });
    app.saveCurrent();
    expect(app.saveNote()).toBe('3 houses are already saved. Remove one on the Compare tab first.');
    expect(JSON.parse(localStorage.getItem('property-offer-analyser.saved.v1')!)).toHaveLength(3);

    app.go('compare');
    fixture.detectChanges();
    expect(app.view()).toBe('compare');
    app.removeSaved('PE1 2QE|');
    expect(app.saved()).toHaveLength(2);
    app.openSaved(app.saved()[0]);
    await settle();
    expect([app.view(), app.inputs().houseNumber, app.inputs().postcode]).toEqual(['analyse', '24', 'PE1 2QA']);
  });

  it('fills in the figures of a saved house when its area data arrives afterwards', async () => {
    let releaseArea: (a: AreaData) => void = () => undefined;
    data.area.mockImplementationOnce(() => new Promise<AreaData>((r) => (releaseArea = r)));
    let releasePlaces: (p: Places) => void = () => undefined;
    data.officialPlaces.mockImplementationOnce(() => new Promise<Places>((r) => (releasePlaces = r)));
    await analyse();
    app.saveCurrent();
    expect(app.saved()[0]).toMatchObject({ crimeTotal: null, floodAreas: null, stationM: null });
    releaseArea(AREA);
    releasePlaces(OFFICIAL);
    await settle();
    expect(app.saved()[0]).toMatchObject({ crimeTotal: 615, floodAreas: 2, hpiChangePct: -1.3, stationM: 900 });
  });

  it('starts from what was saved last time, and survives broken storage', () => {
    localStorage.setItem('property-offer-analyser.inputs.v1', JSON.stringify({ postcode: 'M14 5AB', rentPcm: 900 }));
    localStorage.setItem('property-offer-analyser.saved.v1', 'not json');
    localStorage.setItem('property-offer-analyser.theme', 'dark');
    TestBed.resetTestingModule();
    start();
    expect([app.inputs().postcode, app.inputs().legal, app.saved(), app.theme(), app.moreOpen]).toEqual(['M14 5AB', 1500, [], 'dark', true]);
    localStorage.setItem('property-offer-analyser.inputs.v1', '{broken');
    localStorage.setItem('property-offer-analyser.saved.v1', '{"not":"a list"}');
    localStorage.setItem('property-offer-analyser.theme', 'purple');
    TestBed.resetTestingModule();
    start();
    expect([app.inputs().postcode, app.saved(), app.theme(), app.moreOpen]).toEqual(['', [], null, false]);
  });
});

describe('importing a listing', () => {
  const LISTING = '3 bed terraced house for sale\nBurghley Road, Peterborough PE1\n£159,950\nAdded on 02/10/2026\nEPC rating: D\nGas central heating\nRecently refurbished\nNo onward chain\nDriveway\n68 sq m\nLet at £950 pcm';
  const paste = async (listing: string) => {
    app.listingText.set(listing);
    await app.importListing();
    await settle();
  };
  beforeEach(start);

  it('explains a bare link and an unreadable paste', async () => {
    await paste('https://www.zoopla.co.uk/for-sale/details/74203533/');
    expect(app.importNote()).toContain('That is a link to the listing');
    expect(app.importNote()).toContain('Zoopla does not let');
    expect(app.importLink()).toBe('https://www.zoopla.co.uk/for-sale/details/74203533/');
    await paste('https://example.com/a-house');
    expect(app.importNote()).toContain('The property site does not let');
    await paste('hello there');
    expect(app.importNote()).toContain('Could not read a price or an address');
    expect(app.importLink()).toBe('');
    await paste('3 bed house for sale\n£159,950');
    expect(app.importNote()).toContain('does not show enough of the address');
    expect(app.inputs().asking).toBe(159_950);
  });

  it('analyses straight away when the listing gives the full address', async () => {
    await paste('3 bed terraced house for sale\n12 Burghley Road, Peterborough PE1 2QA\n£159,950');
    expect(app.importNote()).toContain('Full address found in the listing.');
    expect([app.inputs().houseNumber, app.inputs().postcode, app.status()]).toEqual(['12', 'PE1 2QA', 'done']);
    expect(data.streetSales).not.toHaveBeenCalled();
  });

  it('identifies the house from its past sale', async () => {
    data.streetSales.mockResolvedValue([sale('15A', 105_000, '2025-09-12', 'terraced', 'PE1 2QA'), sale('3', 99_000, '2019-01-01', 'terraced', 'PE1 2QB')]);
    await paste(`${LISTING}\nSold September 2025 £105,000`);
    expect(app.importNote()).toContain('Identified as 15A Burghley Road, PE1 2QA');
    expect(app.importNote()).toContain('in September 2025');
    expect(app.importNote()).toContain('£950 a month in rent');
    expect(app.importFound()).toEqual(['Asking £159,950', '3 bed', 'Terraced', 'Burghley Road PE1', 'Listed 2 Oct 2026', '68 m²', 'EPC D', 'Gas heating', 'Refurbished', 'No chain', 'Off-street parking', '1 past sale']);
    expect(app.inputs()).toMatchObject({ houseNumber: '15A', postcode: 'PE1 2QA', epc: 'D', heating: 'gas', condition: 'refurbished', parking: 'offStreet', floorArea: 68, rentPcm: null });
    expect(data.streetSales).toHaveBeenCalledWith('Burghley Road', 'PE1', ['Peterborough']);
  });

  it('offers the parts of the street when the house cannot be pinned down', async () => {
    data.streetSales.mockResolvedValue([sale('1', 1, '2020-01-01', 'terraced', 'PE1 2QB'), sale('2', 1, '2020-01-01', 'terraced', 'PE1 2QB'), sale('3', 1, '2020-01-01', 'terraced', 'PE1 2QA')]);
    await paste('Burghley Road, Peterborough, Cambridgeshire PE1, 2 bed end terrace house for sale, £150,000 - Zoopla https://share.google/abc');
    expect(app.importNote()).toContain('The listing shows no past sale to match');
    expect(app.importNote()).toContain("Only the listing's headline was pasted");
    expect(app.importPostcodes().map((o) => o.postcode)).toEqual(['PE1 2QB', 'PE1 2QA']);
    expect(app.inputs().postcode).toBe('PE1 2QB');
    app.usePostcode('PE1 2QA');
    await settle();
    expect(app.inputs().postcode).toBe('PE1 2QA');
    data.streetSales.mockResolvedValue([sale('1', 1, '2020-01-01', 'terraced', 'PE1 2QB')]);
    await paste(`${LISTING}\nSold September 2025 £105,000`);
    expect(app.importNote()).toContain('The past sales did not point to one single house');
    expect(app.importNote()).not.toContain('pick another part');
  });

  it('says so when the street has no sales or Land Registry is down', async () => {
    await paste(LISTING);
    expect(app.importNote()).toContain('No Land Registry sales found for Burghley Road');
    data.streetSales.mockRejectedValue(new Error('offline'));
    await paste(LISTING);
    expect(app.importNote()).toContain('Land Registry did not respond');
    expect(app.importBusy()).toBe(false);
  });

  it('reads electric heating, a poor EPC and street parking', async () => {
    data.streetSales.mockResolvedValue([sale('1', 1, '2020-01-01', 'terraced', 'PE1 2QB')]);
    await paste('2 bed flat for sale\nPark Road, Peterborough PE1\n£90,000\nEPC rating: F\nElectric heating\nOn street parking\nSold March 2015 £60,000\nSold 2011 £1');
    expect(app.importFound()).toEqual(['Asking £90,000', '2 bed', 'Flat', 'Park Road PE1', 'EPC F or G', 'Electric heating', 'On-street parking only', '1 past sale']);
    await paste('2 bed flat for sale\nPark Road, Peterborough PE1\n£90,000\nEPC rating: B');
    expect(app.importFound()).toContain('EPC A to C');
  });

  it('takes a listing sent by the browser button, with its photos and postcode', async () => {
    const photos = [{ url: 'https://lid.zoocdn.com/u/1024/768/a.jpg', floorPlan: false }, { url: 'https://lid.zoocdn.com/u/1024/768/b.jpg', floorPlan: false }, { url: 'https://lid.zoocdn.com/u/2400/1800/p.jpg', floorPlan: true }];
    app.listingText.set(LISTING);
    await app.importListing({ url: 'https://www.zoopla.co.uk/for-sale/details/74203533/', site: 'Zoopla', text: LISTING, postcode: 'PE1 2QA', photos });
    await settle();
    expect(app.inputs().postcode).toBe('PE1 2QA');
    expect(app.importFound().slice(-2)).toEqual(['2 photos', 'Floor plan']);
    expect([app.galleryPhotos().length, app.floorPlans().length, app.sentFrom()?.site]).toEqual([2, 1, 'Zoopla']);
    expect(text()).toContain('Photos and floor plan');
    // Analysing a house somewhere else drops the pictures.
    data.lookupPostcode.mockResolvedValueOnce({ ...GEO, postcode: 'M14 5AB', outcode: 'M14' });
    await analyse({ postcode: 'M14 5AB' });
    expect([app.photos(), app.sentFrom()]).toEqual([[], null]);
    await app.importListing({ url: '', site: null, text: LISTING, postcode: null, photos: [photos[2], { ...photos[2], url: 'https://lid.zoocdn.com/u/2400/1800/q.jpg' }] });
    expect(app.importFound().slice(-1)).toEqual(['2 floor plans']);
    expect(app.sentFrom()).toBeNull();
  });

  it('imports by itself when the page is opened by the browser button', async () => {
    const sent = { v: 1, u: 'https://www.rightmove.co.uk/properties/174717416', x: '3 bed terraced house for sale\n12 Burghley Road, Peterborough PE1 2QA\n£159,950', p: '', i: [], f: [] };
    location.hash = '#import=' + encodeURIComponent(JSON.stringify(sent));
    TestBed.resetTestingModule();
    start();
    await settle();
    expect(location.hash).toBe('');
    expect([app.inputs().houseNumber, app.inputs().postcode, app.sentFrom()?.site, app.status()]).toEqual(['12', 'PE1 2QA', 'Rightmove', 'done']);
  });
});

describe('small things on the page', () => {
  beforeEach(start);

  it('switches view and theme', () => {
    app.go('glossary');
    fixture.detectChanges();
    expect(text()).toContain('Property terms in plain English');
    app.go('calculators');
    fixture.detectChanges();
    expect(text()).toContain('Mortgage and stamp duty');
    expect(app.calculatorLabel()).toBe('');
    const dark = app.isDark();
    app.toggleTheme();
    fixture.detectChanges();
    expect(app.isDark()).toBe(!dark);
    expect(document.documentElement.dataset['theme']).toBe(dark ? 'light' : 'dark');
    app.toggleTheme();
    expect(app.theme()).toBe(dark ? 'dark' : 'light');
  });

  it('reads what is typed into the form', () => {
    expect(app.text(event('PE1'))).toBe('PE1');
    expect([app.num(event('£159,950')), app.num(event('')), app.num(event('abc')), app.num0(event('')), app.num0(event('12'))]).toEqual([159_950, null, null, 0, 12]);
    expect(app.checked(event(true))).toBe(true);
    app.pick('heating', event('electric'));
    expect(app.inputs().heating).toBe('electric');
    expect(JSON.parse(localStorage.getItem('property-offer-analyser.inputs.v1') ?? '{}').postcode).toBe('');
  });

  it('formats money, percentages, dates and addresses', () => {
    expect([app.gbp(159_950.4), app.gbp(-20), app.gbp(null), app.gbp(NaN)]).toEqual(['£159,950', '-£20', 'n/a', 'n/a']);
    expect([app.pct(4.25), app.pct(4.25, 0), app.pct(undefined)]).toEqual(['4.3%', '4%', 'n/a']);
    expect([app.round1(1.26), app.abs(-3), app.signedPct(3), app.signedPct(-4)]).toEqual([1.3, 3, '+3%', '-4%']);
    expect([app.day('2026-08-17'), app.day('soon')]).toEqual(['17 Aug 2026', 'soon']);
    expect(app.address({ ...sale('24', 1, '2020-01-01'), saon: 'FLAT 2' })).toBe('FLAT 2 24 Burghley Road');
    expect(app.vsAsking(100_000)).toBe('');
    expect([app.crimeChange(615, 539), app.crimeChange(500, 600), app.crimeChange(100, 101), app.crimeChange(5, 0)]).toEqual(['14% more than', '17% fewer than', 'about the same as', 'about the same as']);
    expect(app.metres(1401)).toBe('1.4 km');
  });

  it('describes a school and links to its records', () => {
    const s = { ...school('Good Primary', false), gender: 'girls' as const, selective: true, faith: 'Church of England' };
    expect(app.schoolLine(s)).toBe('Primary, community school, girls, selective, Church of England, ages 5 to 7, 208 pupils');
    expect(app.schoolLine({ ...s, kind: '', independent: true, pupils: null, gender: '', selective: false, faith: '', phase: '', ages: '' })).toBe('independent (fee-paying)');
    expect(app.schoolRecord(s)).toBe('https://get-information-schools.service.gov.uk/Establishments/Establishment/Details/110723');
    expect(app.schoolOfsted(s)).toBe('https://reports.ofsted.gov.uk/search?q=110723');
  });

  it('prints, and stops the bookmark button from running on its own page', () => {
    const printed = vi.fn();
    window.print = printed;
    app.print();
    expect(printed).toHaveBeenCalled();
    const click = { preventDefault: vi.fn() } as unknown as Event;
    app.sendButtonClicked(click);
    expect(click.preventDefault).toHaveBeenCalled();
    expect(app.sendButtonNote()).toContain('Drag it up to your bookmarks bar');
    expect(app.fullAddress()).toBe('the property');
    expect(app.houseFacts()).toMatchObject({ floodAreas: null, sellerYears: null, daysListed: null });
    expect(app.retryPlaces()).toBeUndefined(); // nothing analysed: nothing to retry
    expect([app.currentId(), app.links(), app.sector(), app.calculatorPrice()]).toEqual(['', null, '', null]);
    app.rebuildComps();
    expect(app.comps()).toEqual([]);
  });
});
