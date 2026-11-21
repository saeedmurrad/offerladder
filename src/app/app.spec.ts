import { assumedFloorArea, evidenceGapPct, mortgage, offerLadder, ownSale, ownSaleWeight, quartiles, rentalReturns, maxPriceForYield, sdlt, sdltBreakdown, valuation, adjustmentFactors, sellerPosition } from './engine';
import { compare } from './compare';
import { demandOutlook } from './demand';
import { GLOSSARY } from './glossary';
import { headlineAddress, matchHouse, parseListing, pastedLink, streetPostcodes } from './listing-import';
import { AreaSeries, Comp, DEFAULT_INPUTS, DemandData, HpiMonth, Inputs, Sale, Snapshot } from './models';
import { emailLink, offerMessage, offerReasons, slotLabel, summaryPoints, SummaryFacts, viewingCalendarFile, viewingChecklist, viewingMessage, whatsAppLink } from './next-steps';
import { applyPastedAreas, parsePastedAreas } from './paste';
import { bookmarklet, collectListing, listingPhotos, readSentListing } from './send-button';
import { buildPlaces, metres, OsmElement, placeQueries } from './places';
import { HospitalRecord, hospitalsNear, ofstedResult, schoolCells, SchoolRecord, schoolsNear, StationRecord, stationsNear } from './places-data';

const comp = (price: number, m2: number | null, paon = '1', postcode = 'PE1 2QG'): Comp => ({
  id: `${postcode}|${paon}|${price}`,
  paon,
  saon: '',
  street: 'TEST STREET',
  postcode,
  price,
  date: '2026-05-15',
  type: 'terraced',
  standard: true,
  distanceM: 100,
  selected: true,
  m2,
});

describe('sdlt', () => {
  it('matches the gov.uk worked example: £295,000 standard = £4,750', () => {
    expect(sdlt(295_000, 'standard')).toBe(4_750);
  });
  it('charges nothing up to £125,000 at standard rates', () => {
    expect(sdlt(125_000, 'standard')).toBe(0);
    expect(sdlt(130_000, 'standard')).toBe(100);
  });
  it('adds 5% of the whole price for an additional property', () => {
    expect(sdlt(125_000, 'additional')).toBe(6_250);
    expect(sdlt(136_000, 'additional')).toBe(7_020);
    expect(sdlt(159_950, 'additional')).toBe(8_696);
  });
  it('matches the gov.uk first-time buyer example: £500,000 = £10,000', () => {
    expect(sdlt(500_000, 'firstHome')).toBe(10_000);
    expect(sdlt(150_000, 'firstHome')).toBe(0);
  });
});

describe('valuation and offer ladder', () => {
  // Twelve real terraced-house sales (price, floor area) used in a hand-worked valuation of a 71 m² house.
  const comps = [
    comp(157_000, 71), comp(140_000, 67), comp(136_000, 68), comp(160_000, 68), comp(128_000, 77), comp(130_000, 69),
    comp(150_000, 66), comp(163_000, 63), comp(133_000, 64), comp(136_000, 73), comp(122_500, 58), comp(152_500, 67),
  ];

  it('reproduces the hand analysis: about £131,500 / £140,200 / £151,700 at 71 m² and -6%', () => {
    const v = valuation(comps, 71, -6)!;
    expect(v.basis).toBe('perM2');
    expect(Math.round(v.low / 100) * 100).toBe(131_500);
    expect(Math.round(v.mid / 100) * 100).toBe(140_200);
    expect(Math.round(v.high / 100) * 100).toBe(151_700);
  });

  it('builds the ladder open £125,000, target £136,000, ceiling £140,000', () => {
    const v = valuation(comps, 71, -6)!;
    expect(offerLadder(v, 159_950)).toEqual({ open: 125_000, target: 136_000, ceiling: 140_000 });
  });

  it('never puts an offer above the asking price', () => {
    const v = valuation(comps, 71, 0)!;
    const l = offerLadder(v, 120_000);
    expect(l.ceiling).toBeLessThanOrEqual(120_000);
    expect(l.open).toBeLessThan(l.target);
  });

  it('falls back to prices when floor areas are missing, and needs three comparables', () => {
    const bare = comps.map((c) => ({ ...c, m2: null }));
    expect(valuation(bare, null, 0)!.basis).toBe('price');
    const scaled = valuation(bare, 71, 0, 'terraced')!;
    expect(scaled.basis).toBe('sizeAdjusted');
    expect(scaled.sizeFactor).toBeCloseTo(Math.pow(71 / 83, 0.8), 5);
    expect(scaled.mid).toBeLessThan(valuation(bare, null, 0)!.mid);
    expect(valuation(comps.slice(0, 2), 71, 0)).toBeNull();
  });

  it('quartiles interpolate inclusively', () => {
    expect(quartiles([1, 2, 3, 4, 5])).toEqual([2, 3, 4]);
  });
});

describe('rental returns', () => {
  const i: Inputs = { ...DEFAULT_INPUTS, rentPcm: 900, initialWorks: 6_000, licenceFee: 908, sdltMode: 'additional' };

  it('reproduces the hand analysis for £125,000 at £900 rent', () => {
    const r = rentalReturns(125_000, 900, i);
    expect(r.cashIn).toBe(140_258);
    expect(Math.round(r.netIncome)).toBe(7_477);
    expect(r.netYield).toBeCloseTo(5.33, 1);
  });

  it('finds the price that meets a target yield', () => {
    const price = maxPriceForYield(5, 900, i);
    expect(rentalReturns(price, 900, i).netYield).toBeCloseTo(5, 2);
    expect(price).toBeGreaterThan(130_000);
    expect(price).toBeLessThan(136_000);
  });
});

describe('adjustments and seller position', () => {
  it('sums to -6% for electric heating, EPC E, downstairs bathroom, refurbished, falling market', () => {
    const i: Inputs = { ...DEFAULT_INPUTS, heating: 'electric', epc: 'E', bathroomDownstairs: true, condition: 'refurbished' };
    expect(adjustmentFactors(i, -4.9).reduce((s, f) => s + f.pct, 0)).toBe(-6);
  });

  it('estimates a break-even only for short ownership', () => {
    const sale = (price: number, date: string): Sale => ({ paon: '1', saon: '', street: 'X', postcode: 'AB1 2CD', price, date, type: 'terraced', standard: true, distanceM: 0 });
    const today = new Date('2026-11-20');
    expect(sellerPosition([sale(34_000, '1999-02-05')], 159_950, 0, today)!.breakEven).toBeNull();
    const flip = sellerPosition([sale(105_000, '2025-09-26')], 150_000, 15_000, today)!;
    expect(flip.breakEven).toBeGreaterThan(127_000);
    expect(flip.breakEven).toBeLessThan(137_500);
  });
});

describe('pasted floor areas', () => {
  it('reads rows copied from a sold-price table and matches them to comparables', () => {
    const text = '328, Clarence Road, PE1 2LQ -\t30 Jul 2026\t£157,000\t71 m²\t£2,211\tTerrace (2 bed)\n22, Henry Street, PE1 2QG\t27 Feb 2026\t£150,000\t66 m² 710 sqft\t£2,272\nnot a property line';
    const pasted = parsePastedAreas(text);
    expect(pasted).toEqual([
      { house: '328', postcode: 'PE1 2LQ', m2: 71 },
      { house: '22', postcode: 'PE1 2QG', m2: 66 },
    ]);
    const { comps, matched } = applyPastedAreas([comp(157_000, null, '328', 'PE1 2LQ'), comp(150_000, null, '22', 'PE1 2QG'), comp(1, null, '9', 'PE1 2QG')], pasted);
    expect(matched).toBe(2);
    expect(comps.map((c) => c.m2)).toEqual([71, 66, null]);
  });
});

describe('comparison', () => {
  const snap = (id: string, over: Partial<Snapshot>, inputs: Partial<Inputs> = {}): Snapshot => ({
    id,
    label: id,
    savedAt: '2026-11-20T00:00:00Z',
    inputs: { ...DEFAULT_INPUTS, asking: 150_000, floorArea: 70, ...inputs },
    district: 'Test',
    basis: 'perM2',
    low: 130_000,
    mid: 140_000,
    high: 150_000,
    open: 124_000,
    target: 135_000,
    ceiling: 140_000,
    adjustPct: 0,
    compsUsed: 8,
    netYieldAtTarget: 5,
    netIncome: 7_000,
    cashAtTarget: 145_000,
    daysListed: 30,
    sellerPaid: null,
    sellerYears: null,
    crimeTotal: 500,
    floodAreas: 0,
    hpiChangePct: -1,
    stationM: 800,
    ...over,
  });

  it('needs at least two houses', () => {
    expect(compare([snap('a', {})])).toBeNull();
  });

  it('picks the house that is cheaper against its value and yields more', () => {
    const a = snap('a', { netYieldAtTarget: 5.5, crimeTotal: 400 }, { asking: 139_000 });
    const b = snap('b', { netYieldAtTarget: 4.5, crimeTotal: 600 }, { asking: 160_000 });
    const r = compare([a, b])!;
    expect(r.pick).toBe(0);
    expect(r.totals[0]).toBeGreaterThan(r.totals[1]);
    expect(r.reasons.some((x) => x.startsWith('Best price against nearby sales'))).toBe(true);
  });

  it('leaves out a measure when a house lacks the figure, and flags rough valuations', () => {
    const a = snap('a', { netYieldAtTarget: null, basis: 'price' });
    const b = snap('b', { crimeTotal: 300 });
    const r = compare([a, b])!;
    expect(r.results.find((x) => x.criterion.key === 'yield')!.scored).toBe(false);
    expect(r.weightUsed).toBeLessThan(100);
    expect(r.roughValuation).toBe(true);
    expect(r.pick).toBe(1);
  });

  it('handles three houses and reports a close call by margin', () => {
    const r = compare([snap('a', {}), snap('b', { daysListed: 31 }), snap('c', { daysListed: 29 })])!;
    expect(r.totals).toHaveLength(3);
    expect(r.pick).toBe(1);
  });
});

describe('glossary', () => {
  it('has unique terms, each with a meaning', () => {
    const names = GLOSSARY.map((t) => t.term);
    expect(new Set(names).size).toBe(names.length);
    expect(GLOSSARY.every((t) => t.meaning.length > 20)).toBe(true);
    expect(names).toContain('EPC rating');
  });
});

describe('listing import', () => {
  const ZOOPLA = `Skip to main content
Menu
Instant valuation
Back to search results
12 Photos
3 Floor plans

£159,950

See monthly cost
2 bed terraced house for sale
Burghley Road, Peterborough PE1

2 beds

1 bath

EPC Rating: E

Chain free
Freehold

Added on 16/08/2026

About this property
UPVC double glazing and electric heating
This two bedroom terraced house has been recently renovated throughout. The ground floor includes a downstairs bathroom.
Living Room
3.68m x 3.7m - 12'1" x 12'2"
Property timeline

Listed

August 2026

£159,950

Sold

February 1999

£34,000

More information
44 Cowgate, Peterborough PE1 1NA
Zoopla`;

  const RIGHTMOVE = `Skip to content
Sign in
Property for sale
Ask Rightmove
Property photo 1 of 10.
Atkinson Street, PETERBOROUGH
£170,000
Can you afford it?
Added on 02/10/2026
PROPERTY TYPE

End of Terrace

BEDROOMS

2

BATHROOMS

1

SIZE

764 sq ft
(71 sq m)

TENURE

Freehold
Key features
Gas central heating
In need of some modernisation`;

  it('reads a Zoopla listing page', () => {
    const p = parseListing(ZOOPLA);
    expect(p.source).toBe('Zoopla');
    expect(p.asking).toBe(159_950);
    expect(p.street).toBe('Burghley Road');
    expect(p.places).toEqual(['Peterborough']);
    expect(p.outcode).toBe('PE1');
    expect(p.postcode).toBeNull();
    expect(p.bedrooms).toBe(2);
    expect(p.propertyType).toBe('terraced');
    expect(p.listedDate).toBe('2026-08-16');
    expect(p.epc).toBe('E');
    expect(p.heating).toBe('electric');
    expect(p.condition).toBe('refurbished');
    expect(p.bathroomDownstairs).toBe(true);
    expect(p.chainFree).toBe(true);
    expect(p.floorArea).toBeNull(); // room sizes must not be read as floor area
    expect(p.pastSales).toEqual([{ month: 2, year: 1999, price: 34_000 }]);
  });

  it('reads a Rightmove listing page', () => {
    const p = parseListing(RIGHTMOVE);
    expect(p.source).toBe('Rightmove');
    expect(p.asking).toBe(170_000);
    expect(p.street).toBe('Atkinson Street');
    expect(p.places).toEqual(['PETERBOROUGH']);
    expect(p.outcode).toBeNull();
    expect(p.bedrooms).toBe(2);
    expect(p.propertyType).toBe('terraced');
    expect(p.listedDate).toBe('2026-10-02');
    expect(p.floorArea).toBe(71);
    expect(p.heating).toBe('gas');
    expect(p.condition).toBe('dated');
    expect(p.tenure).toBe('Freehold');
  });

  it('picks up a house number and full postcode when the listing gives them', () => {
    const p = parseListing('3 bed semi-detached house for sale\n12 Park Road, Manchester M14 5AB\n£250,000');
    expect([p.houseNumber, p.street, p.postcode, p.propertyType]).toEqual(['12', 'Park Road', 'M14 5AB', 'semi-detached']);
  });

  const sale = (paon: string, postcode: string, price: number, date: string): Sale => ({ paon, saon: '', street: 'BURGHLEY ROAD', postcode, price, date, type: 'terraced', standard: true, distanceM: null });
  const street = [sale('86', 'PE1 2QE', 34_000, '1999-02-05'), sale('88', 'PE1 2QE', 23_000, '1995-02-13'), sale('15A', 'PE1 2QA', 105_000, '2025-09-26'), sale('57', 'PE1 2QA', 105_000, '2007-12-21')];

  it('identifies the house from its last sale', () => {
    expect(matchHouse([{ month: 2, year: 1999, price: 34_000 }], street)).toEqual({ houseNumber: '86', postcode: 'PE1 2QE', sale: { month: 2, year: 1999, price: 34_000 } });
    expect(matchHouse([{ month: 9, year: 2025, price: 105_000 }], street)!.houseNumber).toBe('15A');
  });

  it('gives no match when nothing fits or two houses fit', () => {
    expect(matchHouse([{ month: 3, year: 2001, price: 50_000 }], street)).toBeNull();
    expect(matchHouse([{ month: null, year: 1999, price: 34_000 }, { month: null, year: 1995, price: 23_000 }], street)).toBeNull();
    expect(streetPostcodes(street)[0].sales).toBe(2);
  });
});

describe('assumed floor area', () => {
  it('assumes a size from bedrooms only when bedrooms are known', () => {
    expect(assumedFloorArea('terraced', 2)).toBe(68);
    expect(assumedFloorArea('flat-maisonette', 1)).toBe(46);
    expect(assumedFloorArea('detached', 9)).toBe(190);
    expect(assumedFloorArea('terraced', null)).toBeNull();
  });
});

describe("the house's own last sale", () => {
  const today = new Date('2026-11-20');
  const sale = (price: number, date: string, standard = true): Sale => ({ paon: '24', saon: '', street: 'X', postcode: 'AB1 2CD', price, date, type: 'semi-detached', standard, distanceM: 0 });
  // Ten nearby sales of a cheaper kind of house: lower quartile £158,000, median £206,250.
  const cheaper = [150_000, 155_000, 158_000, 158_000, 200_000, 212_500, 250_000, 269_000, 269_500, 290_000].map((p, n) => comp(p, null, `${n + 1}`));

  it('weighs a sale less the older it is, and not at all after 7.5 years', () => {
    expect(ownSaleWeight(0)).toBeCloseTo(0.9);
    expect(ownSaleWeight(2)).toBeCloseTo(0.66);
    expect(ownSaleWeight(7.5)).toBe(0);
    expect(ownSale([sale(90_000, '2012-03-01')], 1.5, today)).toBeNull();
    expect(ownSale([], 1, today)).toBeNull();
  });

  it('uses the latest ordinary sale and moves it by the local price index', () => {
    const o = ownSale([sale(154_000, '2010-08-09'), sale(247_500, '2026-08-17'), sale(120_000, '2026-10-01', false)], 1.02, today)!;
    expect(o.paid).toBe(247_500);
    expect(o.indexed).toBeCloseTo(252_450);
    expect(o.movePct).toBeCloseTo(2);
    expect(ownSale([sale(247_500, '2026-08-17')], null, today)!.indexed).toBe(247_500);
  });

  it('does not open far below what the house itself sold for three months ago', () => {
    const before = offerLadder(valuation(cheaper, null, 0)!, null);
    expect(before.open).toBe(150_000); // the fault: £97,500 under a sale made three months earlier
    const v = valuation(cheaper, null, 0, 'terraced', ownSale([sale(247_500, '2026-08-17')], 1, today))!;
    expect(v.compsMid).toBe(206_250);
    expect(v.mid).toBeGreaterThan(240_000);
    expect(v.mid).toBeLessThan(247_500);
    expect(evidenceGapPct(v)!).toBeLessThan(-15);
    const l = offerLadder(v, null);
    expect(l.ceiling).toBeGreaterThan(240_000);
    // Mismatched neighbours spread from £150,000 to £290,000; that scatter must not drag the opening offer down.
    expect(l.open).toBeGreaterThan(247_500 * 0.85);
    expect(v.high).toBeLessThan(247_500 * 1.1);
    expect(l.open).toBeLessThan(l.target);
    expect(l.target).toBeLessThan(l.ceiling);
  });

  it('leaves the value alone when the nearby sales agree with the house', () => {
    const like = [240_000, 245_000, 247_500, 250_000, 255_000].map((p, n) => comp(p, null, `${n + 1}`));
    const v = valuation(like, null, 0, 'terraced', ownSale([sale(247_500, '2026-08-17')], 1, today))!;
    expect(v.mid).toBeCloseTo(247_500);
    expect(Math.abs(evidenceGapPct(v)!)).toBeLessThan(1);
  });

  it('still gives a range from the house alone when there are too few nearby sales', () => {
    const v = valuation(cheaper.slice(0, 2), null, -10, 'terraced', ownSale([sale(200_000, '2026-08-17')], 1, today))!;
    expect(v.basis).toBe('ownSale');
    expect([v.low, v.mid, v.high]).toEqual([190_000, 200_000, 210_000]);
    expect(valuation(cheaper.slice(0, 2), null, 0)).toBeNull();
  });
});

describe('a link pasted instead of the listing', () => {
  it('recognises a bare link and names the site', () => {
    expect(pastedLink('https://www.zoopla.co.uk/for-sale/details/12345678/')).toEqual({ url: 'https://www.zoopla.co.uk/for-sale/details/12345678/', portal: 'Zoopla' });
    expect(pastedLink('  www.rightmove.co.uk/properties/123456789#/?channel=RES_BUY ')!.portal).toBe('Rightmove');
    expect(pastedLink('onthemarket.com/details/1234567/')).toEqual({ url: 'https://onthemarket.com/details/1234567/', portal: 'OnTheMarket' });
    expect(pastedLink('https://example.com/house')!.portal).toBeNull();
  });

  it('recognises a link shared from a phone with a few words around it', () => {
    const p = pastedLink('Check out this property on Zoopla\nhttps://www.zoopla.co.uk/for-sale/details/12345678/.')!;
    expect(p.url).toBe('https://www.zoopla.co.uk/for-sale/details/12345678/');
  });

  it('does not mistake real listing text for a link', () => {
    expect(pastedLink('3 bed terraced house for sale\nBurghley Road, Peterborough PE1\n£159,950\nhttps://www.zoopla.co.uk/for-sale/details/12345678/')).toBeNull();
    expect(pastedLink('3 bed terraced house for sale')).toBeNull();
    expect(pastedLink('')).toBeNull();
  });
});

describe('demand outlook', () => {
  /** 84 months from July 2019 to June 2026. The last two months have no sales count, as in the real index. */
  const months = (indexAt: (n: number) => number, salesAt: (n: number) => number, newBuild: number, average: number): HpiMonth[] =>
    Array.from({ length: 84 }, (_, n) => {
      const y = 2019 + Math.floor((n + 6) / 12);
      const m = ((n + 6) % 12) + 1;
      return { month: `${y}-${String(m).padStart(2, '0')}`, average, index: indexAt(n), byType: {}, sales: n >= 82 ? null : salesAt(n), newBuild: n >= 82 ? null : newBuild };
    });
  const series = (over: Partial<AreaSeries>): AreaSeries => ({ hpi: [], population: [], earnings: [], claimants: [], ...over });
  // The country: prices +2% a year, steady sales, population +0.5% a year, 6 residents per new home, price 7.5 times pay.
  const country = series({
    hpi: months((n) => 100 * Math.pow(1.02, n / 12), () => 50_000, 5_000, 300_000),
    population: [[2020, 56_000_000], [2025, 57_414_000]],
    earnings: [[2020, 32_000], [2025, 40_000]],
    claimants: [['2025-06', 4.0], ['2026-06', 4.0]],
  });
  const data = (area: AreaSeries): DemandData => ({ areaName: 'Testshire', countryName: 'England', area, country });
  const signals = (d: DemandData) => Object.fromEntries(demandOutlook(d, 'terraced').indicators.map((i) => [i.key, i.signal]));

  it('calls an area building when it stands clearly above the country', () => {
    const hot = series({
      hpi: months((n) => 100 * Math.pow(1.05, n / 12), (n) => (n >= 70 ? 240 : 200), 10, 200_000),
      population: [[2020, 200_000], [2025, 212_000]], // +1.2% a year; 12,000 residents against 600 new homes
      earnings: [[2020, 30_000], [2025, 40_000]],
      claimants: [['2025-06', 4.5], ['2026-06', 4.0]],
    });
    const o = demandOutlook(data(hot), 'terraced');
    expect(signals(data(hot))).toEqual({ prices: 'up', sales: 'up', population: 'up', supply: 'up', affordability: 'up', earnings: 'up', jobs: 'up' });
    expect([o.scored, o.up, o.down, o.verdict]).toEqual([7, 7, 0, 'building']);
    expect(o.indicators[0].headline).toContain('All homes: +5.0% in a year');
  });

  it('calls an area easing when it stands clearly below', () => {
    const cold = series({
      hpi: months((n) => 100 * Math.pow(0.98, n / 12), (n) => (n >= 70 ? 150 : 200), 100, 420_000),
      population: [[2020, 200_000], [2025, 199_000]],
      earnings: [[2020, 30_000], [2025, 33_000]],
      claimants: [['2025-06', 4.0], ['2026-06', 4.6]],
    });
    const o = demandOutlook(data(cold), 'terraced');
    expect(signals(data(cold))).toEqual({ prices: 'down', sales: 'down', population: 'down', supply: 'down', affordability: 'down', earnings: 'down', jobs: 'down' });
    expect(o.verdict).toBe('easing');
  });

  it('calls an area that matches the country level on every measure', () => {
    const same = series({ ...country, hpi: country.hpi.map((r) => ({ ...r, sales: r.sales === null ? null : r.sales / 250, newBuild: r.newBuild === null ? null : r.newBuild / 250 })), population: [[2020, 224_000], [2025, 229_656]] });
    const o = demandOutlook(data(same), 'terraced');
    expect(o.indicators.every((i) => i.signal === 'flat')).toBe(true);
    expect(o.verdict).toBe('mixed');
  });

  it('judges sales against the country, so unregistered recent sales do not read as a slump', () => {
    // Both fall 30% in the latest year because recent sales are not all registered yet.
    const lagging = (base: number) => (n: number) => (n >= 70 ? base * 0.7 : base);
    const d: DemandData = { ...data(series({ ...country, hpi: months((n) => 100 * Math.pow(1.02, n / 12), lagging(200), 20, 300_000) })), country: { ...country, hpi: months((n) => 100 * Math.pow(1.02, n / 12), lagging(50_000), 5_000, 300_000) } };
    expect(signals(d)['sales']).toBe('flat');
  });

  it('uses the index for the property type when the area has one', () => {
    const typed = series({ ...country, hpi: country.hpi.map((r, n) => ({ ...r, byType: { terraced: 100 * Math.pow(1.06, n / 12) } })) });
    const withType: DemandData = { ...data(typed), country: { ...country, hpi: country.hpi.map((r) => ({ ...r, byType: { terraced: r.index } })) } };
    const terraced = demandOutlook(withType, 'terraced').indicators[0];
    expect(terraced.signal).toBe('up');
    expect(terraced.headline).toContain('Terraced houses: +6.0% in a year');
    const detached = demandOutlook(withType, 'detached').indicators[0];
    expect(detached.signal).toBe('flat');
    expect(detached.headline).toContain('All homes: +2.0% in a year');
  });

  it('leaves a measure unscored when its figures are missing, and gives no verdict on too few', () => {
    const o = demandOutlook(data(series({ hpi: country.hpi })), 'terraced');
    expect(o.indicators.filter((i) => i.signal === null).map((i) => i.key)).toEqual(['population', 'supply', 'affordability', 'earnings', 'jobs']);
    expect(o.verdict).toBe('unknown');
    expect(demandOutlook(data(series({})), 'terraced').scored).toBe(0);
  });
});

describe('places around the house', () => {
  const LAT = 52.5858;
  const LNG = -0.2408;
  /** A map object a given number of metres north of the house. */
  const at = (metresNorth: number, tags: Record<string, string>, way = false): OsmElement => {
    const lat = LAT + metresNorth / 111_195;
    return way ? { center: { lat, lon: LNG }, tags } : { lat, lon: LNG, tags };
  };
  const near: OsmElement[] = [
    at(640, { amenity: 'school', name: 'Gladstone Primary Academy', 'isced:level': '0;1', min_age: '2', max_age: '11', 'ref:edubase': '143859', 'school:type': 'academy;special', 'operator:type': 'private' }),
    at(35, { amenity: 'school', name: "Queen's Drive Infant School", school: 'primary', min_age: '5', max_age: '7', 'ref:edubase': '110723' }, true),
    at(40, { amenity: 'school', name: "Queen's Drive Infant School" }), // the same school mapped a second time
    at(530, { amenity: 'school', name: 'Thomas Deacon Academy', 'isced:level': '1;2;3', min_age: '7', max_age: '19' }),
    at(900, { amenity: 'school', name: 'Hill House', 'isced:level': '2', fee: 'yes' }),
    at(300, { amenity: 'school' }), // no name: cannot be shown
    at(170, { amenity: 'parking', access: 'private' }),
    at(225, { amenity: 'parking' }), // unmarked: most likely a shop or staff car park
    at(120, { amenity: 'parking', parking: 'street_side', fee: 'yes' }),
    at(410, { amenity: 'parking', name: 'Brook Street Car Park', fee: 'yes', capacity: '180' }),
    at(700, { amenity: 'parking', operator: 'City Council', fee: 'no' }),
    at(570, { amenity: 'doctors', name: 'Park Medical Centre' }),
    at(260, { amenity: 'pharmacy', name: 'Boots' }),
    at(480, { shop: 'supermarket', name: 'Aldi' }),
    at(900, { shop: 'supermarket', name: 'Tesco' }),
    at(350, { leisure: 'park', name: 'Central Park' }),
    at(150, { highway: 'bus_stop' }),
    at(390, { highway: 'bus_stop' }),
    at(600, { highway: 'bus_stop' }), // beyond 400 m
  ];
  const far: OsmElement[] = [
    at(2060, { railway: 'station', name: 'Peterborough (NVR)', usage: 'tourism' }),
    at(1400, { railway: 'station', name: 'Peterborough', network: 'National Rail' }),
    at(9000, { railway: 'station', name: 'Whittlesea' }),
    at(3960, { amenity: 'hospital', name: 'City Care Centre' }),
    at(5200, { amenity: 'hospital', name: 'Peterborough City Hospital', emergency: 'yes' }),
  ];

  it('lists named schools nearest first, once each, with phase, ages and reference number', () => {
    const p = buildPlaces(LAT, LNG, near, far);
    expect(p.schools.map((s) => s.name)).toEqual(["Queen's Drive Infant School", 'Thomas Deacon Academy', 'Gladstone Primary Academy', 'Hill House']);
    expect(p.schools[0]).toMatchObject({ phase: 'Primary', ages: 'ages 5 to 7', urn: '110723', independent: false });
    expect(p.schools[0].distanceM).toBeGreaterThan(30);
    expect(p.schools[0].distanceM).toBeLessThan(40);
    expect(p.schools[1]).toMatchObject({ phase: 'All-through', urn: null });
    // An academy run by a trust is tagged as privately operated; that must not read as fee-paying.
    expect(p.schools[2]).toMatchObject({ kind: 'academy, special school', independent: false });
    expect(p.schools[3]).toMatchObject({ phase: 'Secondary', independent: true });
    expect(p.schoolCount).toBe(4);
  });

  it('keeps only car parks the public can use', () => {
    const p = buildPlaces(LAT, LNG, near, far);
    expect(p.carParks.map((c) => [c.name, c.fee, c.capacity])).toEqual([
      ['Brook Street Car Park', 'yes', 180],
      ['City Council car park', 'no', null],
    ]);
  });

  it('picks the nearest working station and the nearest emergency hospital', () => {
    const p = buildPlaces(LAT, LNG, near, far);
    expect(p.stations.map((s) => s.name)).toEqual(['Peterborough', 'Whittlesea']);
    expect(p.hospitals[0].name).toBe('City Care Centre');
    expect(p.emergency?.name).toBe('Peterborough City Hospital');
    expect([p.busStops, p.supermarketCount, p.supermarket?.name, p.park?.name, p.pharmacy?.name, p.doctors[0].name]).toEqual([2, 2, 'Aldi', 'Central Park', 'Boots', 'Park Medical Centre']);
  });

  it('says which half is missing when one lookup fails, so an empty list is not read as nothing nearby', () => {
    const p = buildPlaces(LAT, LNG, near, null);
    expect([p.nearOk, p.farOk, p.stations.length, p.schools.length]).toEqual([true, false, 0, 4]);
    expect(buildPlaces(LAT, LNG, null, far).nearOk).toBe(false);
  });

  it('asks for every kind of place around the point, and formats distances', () => {
    const q = placeQueries(LAT, LNG);
    for (const word of ['school', 'parking', 'supermarket', 'bus_stop', 'doctors']) expect(q.near).toContain(word);
    expect(q.far).toContain('railway=station');
    expect(q.far).toContain('amenity=hospital');
    expect([metres(34), metres(996), metres(1401), metres(12_340)]).toEqual(['30 m', '1.0 km', '1.4 km', '12.3 km']);
  });

  it('reads parking from a listing', () => {
    expect(parseListing('3 bed house\n£200,000\nDriveway and garage to the side').parking).toBe('offStreet');
    expect(parseListing('2 bed terrace\n£150,000\nOn street parking, permit required').parking).toBe('onStreet');
    expect(parseListing('2 bed terrace\n£150,000\nNo off street parking').parking).toBe('onStreet');
    expect(parseListing('2 bed terrace\n£150,000\nClose to the station').parking).toBeNull();
  });
});

describe('official places data', () => {
  const LAT = 52.5746;
  const LNG = -0.2277;
  const north = (m: number) => LAT + m / 111_195;
  const schools: SchoolRecord[] = [
    ['135263', 'Thomas Deacon Academy', north(1500), LNG, 'A', 'academy', 7, 19, 2300, '', 0, '', ['O', '2023-10', 2, '', 0]],
    ['110723', "Queen's Drive Infant School", north(300), LNG, 'P', 'community school', 5, 7, 208, '', 0, '', ['Q', '2025-02', 2, '', 0]],
    ['143859', 'Lime Academy', north(650), LNG, 'P', 'academy', 3, 11, 423, '', 0, '', ['R', '2026-06', 3, 4, 1, '', 0]],
    ['136398', "The King's School", north(1100), LNG, 'A', 'academy', 7, 18, 1256, 'B', 1, 'Church of England', ['O', '2024-07', 1, '', 1]],
    ['999001', 'Hill House', north(900), LNG, 'S', 'independent (fee-paying)', 11, 18, 0, 'G', 0, '', null],
    ['999002', 'Ysgol Feithrin', north(1200), LNG, '', 'school in Wales', 0, 0, 0, '', 0, '', null],
    ['999003', 'Failing Academy', north(1400), LNG, 'S', 'academy', 11, 16, 600, '', 0, '', ['R', '2026-02', 5, 5, 0, 'SM', 0]],
    ['999004', 'Too Far Primary', north(2500), LNG, 'P', 'academy', 4, 11, 200, '', 0, '', null],
  ];

  it('lists schools within a mile, nearest first, with the register details', () => {
    const list = schoolsNear(schools, LAT, LNG);
    expect(list.map((s) => s.name)).toEqual(["Queen's Drive Infant School", 'Lime Academy', 'Hill House', "The King's School", 'Ysgol Feithrin', 'Failing Academy', 'Thomas Deacon Academy']);
    expect(list[0]).toMatchObject({ urn: '110723', phase: 'Primary', ages: 'ages 5 to 7', kind: 'community school', pupils: 208, independent: false, wales: false });
    expect(list[2]).toMatchObject({ independent: true, gender: 'girls', pupils: null, ofsted: null });
    expect(list[3]).toMatchObject({ gender: 'boys', selective: true, faith: 'Church of England' });
    expect(list[4]).toMatchObject({ wales: true, phase: '', ages: '' });
  });

  it('reports each Ofsted result the way Ofsted gave it', () => {
    expect(ofstedResult(['O', '2023-10', 2, '', 0])).toEqual({ text: 'Good', inspected: 'Oct 2023', concern: '', weak: false, former: false });
    expect(ofstedResult(['Q', '2025-02', 3, '', 0])).toMatchObject({ text: 'Quality of education: Requires improvement', weak: true });
    expect(ofstedResult(['R', '2026-06', 3, 4, 1, '', 0])).toMatchObject({ text: 'Curriculum and teaching: Expected standard; achievement: Needs attention', inspected: 'Jun 2026', weak: true });
    expect(ofstedResult(['R', '2026-02', 5, 5, 0, 'SM', 0])).toMatchObject({ text: 'Curriculum and teaching: Urgent improvement; achievement: Urgent improvement; safeguarding not met', concern: 'in special measures', weak: true });
    expect(ofstedResult(['O', '2024-07', 1, '', 1])).toMatchObject({ text: 'Outstanding', weak: false, former: true });
    expect(ofstedResult(null)).toBeNull();
  });

  it('loads one file of schools, or the neighbours too near the edge of a square', () => {
    expect(schoolCells(52.5746, -0.2277, 1600)).toEqual(['105_-1']);
    expect(schoolCells(52.501, -0.2277, 1600).sort()).toEqual(['104_-1', '105_-1']);
    expect(schoolCells(52.501, -0.001, 1600)).toHaveLength(4);
  });

  it('picks the two nearest stations of either kind', () => {
    const stations: StationRecord[] = [['Whittlesea', north(9000), LNG, 'R'], ['Peterborough', north(1500), LNG, 'R'], ['City Tram Stop', north(700), LNG, 'M'], ['Far Away', north(40_000), LNG, 'R']];
    expect(stationsNear(stations, LAT, LNG).map((s) => [s.name, s.kind])).toEqual([['City Tram Stop', 'Metro or tram'], ['Peterborough', 'Rail']]);
    expect(stationsNear([stations[3]], LAT, LNG)).toEqual([]);
  });

  it('skips private hospitals and mental-health units, and finds the nearest emergency department', () => {
    const hospitals: HospitalRecord[] = [
      ['Sexual Health Clinic Ltd', north(1100), LNG, 'I', 0, 0],
      ['Cavell Centre', north(2000), LNG, 'N', 0, 1],
      ['City Care Centre', north(3000), LNG, 'N', 0, 0],
      ['Peterborough City Hospital', north(3600), LNG, 'N', 1, 0],
      ['Distant General', north(60_000), LNG, 'N', 1, 0],
    ];
    const h = hospitalsNear(hospitals, LAT, LNG);
    expect(h.hospitals.map((x) => x.name)).toEqual(['City Care Centre', 'Peterborough City Hospital']);
    expect(h.emergency?.name).toBe('Peterborough City Hospital');
    expect(hospitalsNear([hospitals[4]], LAT, LNG)).toEqual({ hospitals: [], emergency: null });
  });
});

describe('calculators', () => {
  it('matches a published example: £150,000 with a 10% deposit over 25 years at 5.2% is £805 a month', () => {
    const m = mortgage(150_000, 15_000, 5.2, 25)!;
    expect(m.loan).toBe(135_000);
    expect(Math.round(m.monthly)).toBe(805);
    expect(Math.round(m.interestOnlyMonthly)).toBe(585);
    expect(m.totalRepaid).toBeCloseTo(m.monthly * 300, 6);
    expect(m.totalInterest).toBeCloseTo(m.totalRepaid - 135_000, 6);
  });

  it('handles a 0% rate, and gives nothing when there is nothing to borrow', () => {
    expect(mortgage(120_000, 0, 0, 10)!.monthly).toBe(1_000);
    expect(mortgage(150_000, 150_000, 5, 25)).toBeNull();
    expect(mortgage(150_000, 200_000, 5, 25)).toBeNull();
    expect(mortgage(0, 0, 5, 25)).toBeNull();
    expect(mortgage(150_000, 15_000, 5, 0)).toBeNull();
  });

  it('breaks stamp duty into bands that add up to the total', () => {
    const cases: [number, 'standard' | 'firstHome' | 'additional', boolean][] = [
      [295_000, 'standard', false], [150_000, 'additional', false], [500_000, 'firstHome', false], [625_000, 'firstHome', false],
      [1_750_000, 'standard', true], [90_000, 'standard', false], [425_000, 'firstHome', true],
    ];
    for (const [price, mode, abroad] of cases) {
      const bands = sdltBreakdown(price, mode, abroad);
      expect(Math.floor(bands.reduce((sum, b) => sum + b.tax, 0) + 1e-6)).toBe(sdlt(price, mode, abroad));
      expect(bands.reduce((sum, b) => sum + b.slice, 0)).toBe(price);
    }
  });

  it('shows the gov.uk example band by band: £295,000 is 0% on £125,000, 2% on £125,000 and 5% on £45,000', () => {
    expect(sdltBreakdown(295_000, 'standard').map((b) => [b.ratePct, b.slice, b.tax])).toEqual([[0, 125_000, 0], [2, 125_000, 2_500], [5, 45_000, 2_250]]);
    expect(sdltBreakdown(150_000, 'additional').map((b) => [b.ratePct, b.tax])).toEqual([[5, 6_250], [7, 1_750]]);
    // First-home relief: nothing up to £300,000, 5% above, and none at all once the price passes £500,000.
    expect(sdltBreakdown(400_000, 'firstHome').map((b) => [b.ratePct, b.slice])).toEqual([[0, 300_000], [5, 100_000]]);
    expect(sdltBreakdown(625_000, 'firstHome')).toEqual(sdltBreakdown(625_000, 'standard'));
    expect(sdltBreakdown(0, 'standard')).toEqual([]);
  });
});

describe('next steps', () => {
  const address = '24 Glebe Road, PE7 3RQ';

  it('writes a viewing request with the times offered', () => {
    const two = viewingMessage({ address, slots: ['2026-11-28T10:30', '2026-11-30T17:00'], name: 'Sam' });
    expect(two).toContain('I would like to view 24 Glebe Road, PE7 3RQ.');
    expect(two).toContain('- Sat 28 Nov at 10:30');
    expect(two).toContain('- Mon 30 Nov at 17:00');
    expect(two.endsWith('Thank you,\nSam')).toBe(true);
    expect(viewingMessage({ address, slots: ['2026-11-28T10:30', ''], name: '' })).toContain('Would Sat 28 Nov at 10:30 work?');
    expect(viewingMessage({ address, slots: ['', ''], name: '' })).toContain('which times are available');
    expect(slotLabel('not a date')).toBe('');
  });

  it('puts the checks that matter for this house first', () => {
    const plain = viewingChecklist({ inputs: { ...DEFAULT_INPUTS, parking: 'offStreet' }, floodAreas: 0, sellerYears: 12, daysListed: 10 });
    expect(plain[0]).toContain('boiler');
    expect(plain.some((c) => c.includes('damp'))).toBe(true);
    const flagged = viewingChecklist({ inputs: { ...DEFAULT_INPUTS, propertyType: 'flat-maisonette', epc: 'FG', heating: 'electric', condition: 'refurbished', parking: 'onStreet' }, floodAreas: 2, sellerYears: 0.8, daysListed: 95 });
    expect(flagged[0]).toContain('95 days');
    for (const word of ['under three years', 'electrical certificate', 'gas supply', 'EPC F or G', 'ever flooded', 'permits', 'lease']) expect(flagged.join(' ')).toContain(word);
    expect(flagged.length).toBeGreaterThan(plain.length);
  });

  it('writes the offer with reasons and the buyer position, and never the maximum', () => {
    const inputs: Inputs = { ...DEFAULT_INPUTS, condition: 'dated', epc: 'E', parking: 'onStreet' };
    const reasons = offerReasons(inputs, 75);
    expect(reasons).toEqual(['the updating the house needs', 'its EPC rating of E', 'the lack of parking', 'the 75 days it has been on the market']);
    const cash = offerMessage({ address, amount: 222_000, asking: 250_000, cash: true, reasons, name: 'Sam' });
    expect(cash).toContain('I would like to offer £222,000, subject to contract and survey.');
    expect(cash).toContain('the lack of parking and the 75 days it has been on the market.');
    expect(cash).toContain('cash buyer');
    expect(cash).not.toContain('246,000');
    const mortgaged = offerMessage({ address, amount: 250_000, asking: 250_000, cash: false, reasons: [], name: '' });
    expect(mortgaged).toContain('agreement in principle');
    expect(mortgaged).not.toContain('The figure reflects'); // an offer at the asking price needs no justification
    expect(offerReasons(DEFAULT_INPUTS, 10)).toEqual([]);
  });

  it('makes a calendar file and message links', () => {
    const file = viewingCalendarFile(address, '2026-11-28T10:30', ['Look for damp; check, the roof'])!;
    expect(file).toContain('DTSTART:20261128T103000');
    expect(file).toContain('DTEND:20261128T110000');
    expect(file).toContain('SUMMARY:Viewing: 24 Glebe Road\\, PE7 3RQ');
    expect(file).toContain('- Look for damp\\; check\\, the roof');
    expect(file.split('\r\n')[0]).toBe('BEGIN:VCALENDAR');
    expect(viewingCalendarFile(address, '', [])).toBeNull();
    expect(emailLink('Offer: 24 Glebe Road', 'Hello,\n£222,000')).toBe('mailto:?subject=Offer%3A%2024%20Glebe%20Road&body=Hello%2C%0A%C2%A3222%2C000');
    expect(whatsAppLink('Hello there')).toBe('https://wa.me/?text=Hello%20there');
  });

  it('sums the report up in plain lines, and says nothing about what it does not know', () => {
    const none: SummaryFacts = {
      stance: null, asking: null, sellerPaid: null, sellerPaidDate: null, sellerYears: null, daysListed: null, netYieldAtTarget: null, targetYield: 5,
      stationName: null, stationWalkMinutes: null, schools: null, schoolsGood: null, demand: null, district: 'Peterborough', floodAreas: null,
      crimeNow: null, crimeYearAgo: null, epc: 'unknown', parking: 'unknown',
    };
    expect(summaryPoints(none)).toEqual([]);
    const points = summaryPoints({
      ...none, stance: 'above', asking: 260_000, sellerPaid: 247_500, sellerPaidDate: '2026-08-17', sellerYears: 0.3, daysListed: 80, netYieldAtTarget: 4.2,
      stationName: 'Peterborough', stationWalkMinutes: 12, schools: 11, schoolsGood: 6, demand: 'easing', floodAreas: 2, crimeNow: 615, crimeYearAgo: 539, epc: 'FG', parking: 'onStreet',
    });
    const text = points.map((p) => `${p.tone}: ${p.text}`).join('\n');
    for (const line of [
      'bad: The asking price of £260,000 is more than the evidence supports',
      'info: The seller paid £247,500 in Aug 2026',
      'good: It has been for sale for 80 days',
      'bad: As a rental it returns 4.2% a year after costs at the price to aim for, short of your 5% target',
      'good: Peterborough station is 12 minutes on foot',
      'good: 11 schools within a mile, 6 with a good or better Ofsted result',
      'bad: Demand in Peterborough is easing',
      'bad: It is within 1 km of 2 flood alert areas',
      'bad: Recorded crime within a mile is 14% higher than a year ago',
      'bad: An EPC of F or G',
      'info: It has no parking of its own',
    ]) expect(text).toContain(line);
  });
});

describe('a shared listing headline', () => {
  // What Chrome's Share button puts on the clipboard: the page title and a short link.
  const SHARED = 'Burghley Road, Peterborough, Cambridgeshire PE1, 2 bed end terrace house for sale, £150,000 - Zoopla https://share.google/jpJZyimNVBbX4LXiS';

  it('reads the price, address, bedrooms and type from a Zoopla headline with its link', () => {
    expect(pastedLink(SHARED)).toBeNull(); // it carries real details, so it is not treated as a bare link
    const p = parseListing(SHARED);
    expect(p).toMatchObject({ source: 'Zoopla', asking: 150_000, street: 'Burghley Road', places: ['Peterborough', 'Cambridgeshire'], outcode: 'PE1', postcode: null, houseNumber: null, bedrooms: 2, propertyType: 'terraced' });
  });

  it('reads the same headline split over lines, as a phone shares it', () => {
    const p = parseListing('Burghley Road, Peterborough, Cambridgeshire PE1, 2 bed end terrace house for sale, £150,000 - Zoopla\nhttps://www.zoopla.co.uk/for-sale/details/74203533/');
    expect(p).toMatchObject({ asking: 150_000, street: 'Burghley Road', outcode: 'PE1', bedrooms: 2 });
  });

  it('reads Rightmove and OnTheMarket headlines', () => {
    expect(headlineAddress('3 bedroom detached bungalow for sale in Bowmore, PA43')).toBe('Bowmore, PA43');
    const rm = parseListing('4 bedroom semi-detached house for sale in Western Avenue, Peterborough, PE1 | Rightmove https://www.rightmove.co.uk/properties/174717416');
    expect(rm).toMatchObject({ source: 'Rightmove', asking: null, street: 'Western Avenue', places: ['Peterborough'], outcode: 'PE1', bedrooms: 4, propertyType: 'semi-detached' });
    const otm = parseListing('Western Avenue, Peterborough 4 bed semi-detached house for sale - £270,000');
    expect(otm).toMatchObject({ asking: 270_000, street: 'Western Avenue', places: ['Peterborough'], bedrooms: 4, propertyType: 'semi-detached' });
  });

  it('does not invent an address from a line that has none', () => {
    expect(headlineAddress('2 bed end terrace house for sale, £150,000 - Zoopla')).toBeNull();
    expect(headlineAddress('Check out this lovely home')).toBeNull();
    expect(parseListing('2 bed house for sale, £150,000').street).toBeNull();
  });

  it('still reads a whole listing page as before', () => {
    const p = parseListing('3 bed terraced house for sale\nBurghley Road, Peterborough PE1\n£159,950\nAdded on 02/10/2026\nSold February 1999 £34,000');
    expect(p).toMatchObject({ asking: 159_950, street: 'Burghley Road', outcode: 'PE1', bedrooms: 3, listedDate: '2026-10-02' });
    expect(p.pastSales).toHaveLength(1);
  });
});

describe('the Send to OfferLadder button', () => {
  const APP = 'https://example.test/offerladder/';
  const HASH = 'da172493def22041e5dde2f0bd9a49c7e821f3c9';
  const HASH2 = '54a7e79c5d9fc3ac3ec858a2927d47dc3018b6fa';
  const PLAN = '484028ec4ef83e9f1f9b27c74e66713c9e9b1289';
  /** A cut-down Zoopla listing page: two sizes of each photo, one photo only in the page data, the floor plan by file name, the postcode in two parts. */
  const zooplaPage = `
    <h1>2 bed end terrace house for sale</h1><p>Burghley Road, Peterborough, Cambridgeshire PE1</p><p>£150,000</p><p>Added on 10/09/2026</p>
    <picture><source srcset="https://lid.zoocdn.com/u/480/360/${HASH}.jpg:p 480w, https://lid.zoocdn.com/u/1024/768/${HASH}.jpg:p 768w"><img src="https://lid.zoocdn.com/u/480/360/${HASH}.jpg"></picture>
    <img src="https://st.zoocdn.com/zoopla_static_agent_logo_(640056).png"><img src="https://example.com/tracker.jpg">
    <script>self.__next_f.push([1,"{\\"image\\":\\"https:\\/\\/lid.zoocdn.com\\/u\\/1024\\/768\\/${HASH2}.jpg\\",\\"floorPlan\\":{\\"image\\":[{\\"caption\\":\\"Fp\\",\\"filename\\":\\"${PLAN}.jpg\\"}],\\"pdf\\":null},\\"outcode\\":\\"PE1\\",\\"incode\\":\\"2QA\\"}"])</script>`;

  function clickOn(page: string): string {
    document.body.innerHTML = page;
    let opened = '';
    const realOpen = window.open;
    window.open = ((url: string) => ((opened = url), {})) as unknown as typeof window.open;
    try {
      collectListing(APP);
    } finally {
      window.open = realOpen;
    }
    return opened;
  }

  it('collects the text, one address per picture at its largest size, the floor plan and the postcode', () => {
    const opened = clickOn(zooplaPage);
    expect(opened.startsWith(`${APP}#import=`)).toBe(true);
    const data = JSON.parse(decodeURIComponent(opened.slice(`${APP}#import=`.length)));
    expect(data.i).toEqual([`https://lid.zoocdn.com/u/1024/768/${HASH}.jpg`, `https://st.zoocdn.com/zoopla_static_agent_logo_(640056).png`, `https://lid.zoocdn.com/u/1024/768/${HASH2}.jpg`]);
    expect(data.f).toEqual([`${PLAN}.jpg`]);
    expect(data.p).toBe('PE1 2QA');
    expect(data.x).toContain('Burghley Road, Peterborough');
  });

  it('is read back by the app as a listing with its photos, floor plan and postcode', () => {
    const opened = clickOn(zooplaPage);
    const sent = readSentListing(opened.slice(APP.length))!;
    // The test page lives on localhost, not on a property site, so its own address is not kept.
    expect(sent.url).toBe('');
    expect(sent.postcode).toBe('PE1 2QA');
    expect(sent.photos).toEqual([
      { url: `https://lid.zoocdn.com/u/1024/768/${HASH}.jpg`, floorPlan: false },
      { url: `https://lid.zoocdn.com/u/1024/768/${HASH2}.jpg`, floorPlan: false },
      { url: `https://lid.zoocdn.com/u/2400/1800/${PLAN}.jpg`, floorPlan: true },
    ]);
    // (The test browser has no line breaks in page text, so reading the text into a listing is checked on the real page instead.)
    expect(sent.text).toContain('£150,000');
  });

  it('keeps only this listing\'s pictures on Rightmove and OnTheMarket', () => {
    const rm = listingPhotos(
      [
        'https://media.rightmove.co.uk/property-photo/7c777e2ea/174717416/7c777e2eaaab920ed3efa4a884150b9b.jpeg',
        'https://media.rightmove.co.uk/property-floorplan/52b57b270/174717416/52b57b270bbfb194d6153edc706d80d0.jpeg',
        'https://media.rightmove.co.uk/property-photo/aaaaaaaaa/999999999/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpeg', // another house further down the page
        'https://media.rightmove.co.uk/partner-logo/12866239-LOGO-1786621232507.jpg',
        'https://media.rightmove.co.uk/assets/a04c/images/happy-people.jpg',
      ],
      [],
      'https://www.rightmove.co.uk/properties/174717416#/?channel=RES_BUY',
    );
    expect(rm.map((p) => [p.url.split('/')[3], p.floorPlan])).toEqual([['property-photo', false], ['property-floorplan', true]]);
    const otm = listingPhotos(
      ['https://media.onthemarket.com/properties/20258030/1659576182/floor-plan-0-original.jpg', 'https://media.onthemarket.com/properties/20258030/1659576182/image-0-1024x1024.jpg', 'https://media.onthemarket.com/agents/companies/14724/260218120132305/logo-190x100.png'],
      [],
      'https://www.onthemarket.com/details/20258030/',
    );
    expect(otm.map((p) => p.floorPlan)).toEqual([false, true]); // photos first, the plan last
  });

  it('shows each picture once, even if it is sent twice', () => {
    const twice = ['https://lid.zoocdn.com/u/1024/768/' + HASH + '.jpg', 'https://lid.zoocdn.com/u/1024/768/' + HASH + '.jpg', 'https://lid.zoocdn.com/u/1024/768/' + HASH2 + '.jpg'];
    expect(listingPhotos(twice, [PLAN + '.jpg', PLAN + '.jpg'], 'https://www.zoopla.co.uk/for-sale/details/74203533/').map((p) => p.url.split('/').pop())).toEqual([HASH + '.jpg', HASH2 + '.jpg', PLAN + '.jpg']);
  });

  it('refuses anything that is not a picture on a property site', () => {
    const bad = ['http://lid.zoocdn.com/u/1024/768/' + HASH + '.jpg', 'https://evil.example/lid.zoocdn.com/u/1/1/x.jpg', 'https://lid.zoocdn.com.evil.example/u/1024/768/x.jpg', 'javascript:alert(1)', 'https://lid.zoocdn.com/u/1024/768/x.svg', 'not a url'];
    expect(listingPhotos(bad, ['../../etc/passwd', '<script>.jpg'], 'https://www.zoopla.co.uk/for-sale/details/74203533/')).toEqual([]);
    expect(readSentListing('#import=not-json')).toBeNull();
    expect(readSentListing('#offer')).toBeNull();
    expect(readSentListing('#import=' + encodeURIComponent(JSON.stringify({ v: 1, x: '' })))).toBeNull();
    const sent = readSentListing('#import=' + encodeURIComponent(JSON.stringify({ v: 1, u: 'https://evil.example/x', x: 'some text', p: 'DROP TABLE', i: 'nope', f: null })))!;
    expect(sent).toEqual({ url: '', site: null, text: 'some text', postcode: null, photos: [] });
    const good = readSentListing('#import=' + encodeURIComponent(JSON.stringify({ v: 1, u: 'https://www.zoopla.co.uk/for-sale/details/74203533/', x: 'text', p: 'pe1 2qa', i: [], f: [] })))!;
    expect(good).toMatchObject({ url: 'https://www.zoopla.co.uk/for-sale/details/74203533/', site: 'Zoopla', postcode: 'PE1 2QA' });
  });

  it('is a bookmark that runs by itself', () => {
    const href = bookmarklet(APP);
    expect(href.startsWith('javascript:')).toBe(true);
    document.body.innerHTML = zooplaPage;
    let opened = '';
    const realOpen = window.open;
    window.open = ((url: string) => ((opened = url), {})) as unknown as typeof window.open;
    try {
      new Function(decodeURIComponent(href.slice('javascript:'.length)))();
    } finally {
      window.open = realOpen;
    }
    expect(opened.startsWith(`${APP}#import=`)).toBe(true);
    expect(JSON.parse(decodeURIComponent(opened.slice(`${APP}#import=`.length))).p).toBe('PE1 2QA');
  });
});
