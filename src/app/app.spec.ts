import { assumedFloorArea, evidenceGapPct, offerLadder, ownSale, ownSaleWeight, quartiles, rentalReturns, maxPriceForYield, sdlt, valuation, adjustmentFactors, sellerPosition } from './engine';
import { compare } from './compare';
import { GLOSSARY } from './glossary';
import { matchHouse, parseListing, pastedLink, streetPostcodes } from './listing-import';
import { Comp, DEFAULT_INPUTS, Inputs, Sale, Snapshot } from './models';
import { applyPastedAreas, parsePastedAreas } from './paste';

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
