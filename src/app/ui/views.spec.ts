import { Type } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DEFAULT_INPUTS, Snapshot } from '../models';
import { HouseFacts } from '../next-steps';
import { CalculatorsView } from './calculators-view';
import { CompareView } from './compare-view';
import { GlossaryView } from './glossary-view';
import { Icon } from './icon';
import { NextStepsView } from './next-steps-view';
import { ValueBar } from './value-bar';

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
beforeEach(() => Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true }));

function render<T>(type: Type<T>, inputs: Record<string, unknown> = {}): ComponentFixture<T> {
  TestBed.resetTestingModule(); // each call starts a fresh page, so one test can draw more than one
  TestBed.configureTestingModule({ imports: [type] });
  const fixture = TestBed.createComponent(type);
  for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
  fixture.detectChanges();
  return fixture;
}
const el = (fixture: ComponentFixture<unknown>) => fixture.nativeElement as HTMLElement;
const text = (fixture: ComponentFixture<unknown>) => (el(fixture).textContent ?? '').replace(/\s+/g, ' ');
/** Types into a field, or picks from a list, the way a person would. */
function enter(fixture: ComponentFixture<unknown>, id: string, value: string | boolean, type = 'input'): void {
  const field = el(fixture).querySelector(`#${id}`) as HTMLInputElement;
  if (typeof value === 'boolean') field.checked = value;
  else field.value = value;
  field.dispatchEvent(new Event(type, { bubbles: true }));
  fixture.detectChanges();
}
const button = (fixture: ComponentFixture<unknown>, label: string) => [...el(fixture).querySelectorAll('button, a')].find((b) => (b.textContent ?? '').includes(label)) as HTMLElement;

describe('calculators view', () => {
  it('starts from the house on the page and works out the payment and the tax', () => {
    const f = render(CalculatorsView, { startPrice: 150_000, startDepositPct: 10, startRate: 5.2, startMode: 'additional', houseLabel: 'the "aim for" price of PE1 2QA' });
    expect(text(f)).toContain('Filled in from the "aim for" price of PE1 2QA');
    expect(text(f)).toContain('£805 per month');
    expect(text(f)).toContain('£135,000');
    expect(text(f)).toContain('£8,000'); // additional property at £150,000
    expect((el(f).querySelector('#mortgageDeposit') as HTMLInputElement).value).toBe('15000');
  });

  it('follows every field as it is changed', () => {
    const f = render(CalculatorsView);
    expect(text(f)).toContain('Enter a price to see the monthly payment');
    enter(f, 'mortgagePrice', '£200,000');
    enter(f, 'mortgageDeposit', '50000', 'change');
    expect((el(f).querySelector('#mortgageDepositPct') as HTMLInputElement).value).toBe('25');
    enter(f, 'mortgageDepositPct', '250'); // more than the whole price is held at 100%
    expect(text(f)).toContain('Enter a price, a deposit smaller than the price');
    enter(f, 'mortgageDepositPct', '20');
    enter(f, 'mortgageTerm', '30', 'change');
    enter(f, 'mortgageRate', '0');
    expect(text(f)).toContain('£444 per month'); // £160,000 over 360 months with no interest
    enter(f, 'mortgagePrice', 'nonsense');
    enter(f, 'mortgageDeposit', '10', 'change'); // no price to take a share of: ignored
    expect(text(f)).toContain('Enter a price, a deposit smaller than the price');

    enter(f, 'dutyPrice', '295000');
    enter(f, 'dutyMode', 'standard', 'change');
    expect(text(f)).toContain('£4,750');
    expect(text(f)).toContain('1.6% of the price');
    expect(text(f)).toContain('Over £250,000 to £925,000');
    enter(f, 'dutyNonResident', true, 'change');
    expect(text(f)).toContain('£10,650'); // 2% more on the whole price
    enter(f, 'dutyNonResident', false, 'change');
    enter(f, 'dutyMode', 'firstHome', 'change');
    expect(text(f)).toContain('Up to £300,000');
    enter(f, 'dutyPrice', '625000');
    expect(text(f)).toContain('No first-home relief at this price');
    enter(f, 'dutyPrice', '2000000');
    expect(text(f)).toContain('Over £1,500,000');
    enter(f, 'dutyPrice', '');
    expect(text(f)).toContain('Enter a price to see the tax');
  });
});

describe('compare view', () => {
  const snap = (id: string, over: Partial<Snapshot> = {}): Snapshot => ({
    id,
    label: `${id} Test Street`,
    savedAt: '2026-11-21T00:00:00Z',
    inputs: { ...DEFAULT_INPUTS, asking: 150_000, floorArea: 70, bedrooms: 2 },
    district: 'Peterborough',
    basis: 'perM2',
    low: 130_000,
    mid: 150_000,
    high: 165_000,
    open: 124_000,
    target: 140_000,
    ceiling: 150_000,
    adjustPct: 0,
    compsUsed: 12,
    netYieldAtTarget: 5,
    netIncome: 7_000,
    cashAtTarget: 150_000,
    daysListed: 30,
    sellerPaid: 100_000,
    sellerYears: 6.2,
    crimeTotal: 300,
    floodAreas: 0,
    hpiChangePct: 1.5,
    stationM: 900,
    ...over,
  });

  it('invites you to add houses until there are two', () => {
    const f = render(CompareView, { saved: [] });
    expect(text(f)).toContain('Nothing saved yet');
    let asked = false;
    f.componentInstance.goAnalyse.subscribe(() => (asked = true));
    button(f, 'Analyse a house').click();
    expect(asked).toBe(true);
    f.componentRef.setInput('saved', [snap('1')]);
    f.detectChanges();
    expect(text(f)).toContain('1 Test Street is saved. Add one more house');
  });

  it('picks a house, says why, and shows every figure side by side', () => {
    const cheap = snap('1', { inputs: { ...DEFAULT_INPUTS, asking: 120_000, floorArea: 70, bedrooms: 2, heating: 'gas', epc: 'D', condition: 'refurbished' }, netYieldAtTarget: 7.5, daysListed: 90, crimeTotal: 100, adjustPct: 3 });
    const dear = snap('2', { inputs: { ...DEFAULT_INPUTS, asking: 175_000, floorArea: null, bedrooms: null }, basis: 'ownSale', netYieldAtTarget: null, daysListed: null, sellerPaid: null, sellerYears: null, crimeTotal: null, floodAreas: null, stationM: null, hpiChangePct: null });
    const f = render(CompareView, { saved: [cheap, dear, snap('3 A Very Long Name That Goes On And On', { basis: 'sizeAdjusted' }), snap('4', { basis: 'price', inputs: { ...DEFAULT_INPUTS, asking: null } })].slice(0, 3) });
    const page = text(f);
    expect(page).toContain('Our pick of 3');
    expect(el(f).querySelector('h1')!.textContent).toContain('1 Test Street');
    for (const part of ['Why this one', '£120,000', "The house's own last sale", 'Size-adjusted estimate, 12 sales', 'Per m², 12 sales', 'No record', 'Refurbished (+3%)', 'Gas central', '0.9 km', 'n/a']) expect(page).toContain(part);
    const opened: string[] = [];
    const removed: string[] = [];
    f.componentInstance.open.subscribe((s) => opened.push(s.id));
    f.componentInstance.remove.subscribe((id) => removed.push(id));
    button(f, 'Open').click();
    button(f, 'Remove').click();
    expect([opened.length, removed.length]).toEqual([1, 1]);
  });

  it('calls a close result close, and copes with a price-only valuation and no asking price', () => {
    const f = render(CompareView, { saved: [snap('1'), snap('2', { basis: 'price', inputs: { ...DEFAULT_INPUTS, asking: null, floorArea: null, bedrooms: null } })] });
    expect(text(f)).toContain('Close call');
    expect(text(f)).toContain('Price only, 12 sales');
  });
});

describe('glossary view', () => {
  it('filters by search and by topic', () => {
    const f = render(GlossaryView);
    const all = el(f).querySelectorAll('dt').length;
    expect(all).toBeGreaterThan(40);
    enter(f, 'glossarySearch', 'leasehold');
    const found = el(f).querySelectorAll('dt').length;
    expect(found).toBeGreaterThan(0);
    expect(found).toBeLessThan(all);
    enter(f, 'glossarySearch', 'zzzz');
    expect(text(f)).toContain('No term matches "zzzz"');
    enter(f, 'glossarySearch', '');
    const topic = [...el(f).querySelectorAll('[role=group] button')][1] as HTMLElement;
    topic.click();
    f.detectChanges();
    expect(el(f).querySelectorAll('section').length).toBe(1);
    button(f, 'All').click();
    f.detectChanges();
    expect(el(f).querySelectorAll('dt').length).toBe(all);
  });
});

describe('icon and value bar', () => {
  it('draws an icon at the size asked for', () => {
    const f = render(Icon, { name: 'home', size: 24 });
    const svg = el(f).querySelector('svg')!;
    expect([svg.getAttribute('width'), svg.querySelector('path')!.getAttribute('d')!.length > 10]).toEqual(['24', true]);
  });

  it('places the offers and the asking price along the value range', () => {
    const f = render(ValueBar, { low: 130_000, mid: 150_000, high: 165_000, open: 124_000, target: 140_000, ceiling: 150_000, asking: 170_000 });
    expect(text(f)).toContain('Range the evidence supports');
    expect(el(f).querySelector('[aria-label]')?.getAttribute('aria-label') ?? text(f)).toContain('asking £170k');
    f.componentRef.setInput('asking', null);
    f.componentRef.setInput('high', 1_650_000);
    f.detectChanges();
    expect(el(f).querySelector('[aria-label]')?.getAttribute('aria-label') ?? text(f)).toContain('£1.65m');
    const flat = render(ValueBar, { low: 0, mid: 0, high: 0, open: 0, target: 0, ceiling: 0 });
    expect(text(flat)).toContain('£0k');
  });
});

describe('next steps view', () => {
  const facts: HouseFacts = { inputs: { ...DEFAULT_INPUTS, asking: 250_000, condition: 'dated', useMortgage: true }, floodAreas: 1, sellerYears: 1, daysListed: 75 };
  const inputs = { address: '24 Glebe Road, PE7 3RQ', houseId: 'PE7 3RQ|24', facts, ladder: { open: 222_000, target: 240_000, ceiling: 246_000 } };
  const value = (f: ComponentFixture<unknown>, id: string) => (el(f).querySelector(`#${id}`) as HTMLTextAreaElement).value;

  it('writes the viewing request and remembers the time, ticks and notes for the house', () => {
    const f = render(NextStepsView, inputs);
    expect(value(f, 'viewingMessage')).toContain('which times are available');
    enter(f, 'viewingSlot1', '2026-11-28T10:30');
    enter(f, 'viewingSlot2', '2026-11-30T17:00');
    enter(f, 'buyerName', 'Sam');
    expect(value(f, 'viewingMessage')).toContain('- Sat 28 Nov at 10:30');
    expect(value(f, 'viewingMessage').endsWith('Thank you,\nSam')).toBe(true);
    expect(text(f)).toContain('Your viewing is noted for Sat 28 Nov at 10:30');

    const boxes = el(f).querySelectorAll('input[type=checkbox]') as NodeListOf<HTMLInputElement>;
    expect(boxes.length).toBeGreaterThan(6);
    boxes[0].click();
    boxes[1].click();
    boxes[0].click(); // changed their mind about the first
    f.detectChanges();
    expect(text(f)).toContain(`1 of ${boxes.length} done`);
    enter(f, 'viewingNotes', 'Damp in the back bedroom');
    enter(f, 'viewingMessage', 'My own words'); // ticks and notes must not overwrite an edited message
    boxes[2].click();
    f.detectChanges();
    expect(value(f, 'viewingMessage')).toBe('My own words');

    const stored = JSON.parse(localStorage.getItem('property-offer-analyser.viewings.v1')!);
    expect(stored['PE7 3RQ|24']).toMatchObject({ slots: ['2026-11-28T10:30', '2026-11-30T17:00'], notes: 'Damp in the back bedroom' });
    expect(stored['PE7 3RQ|24'].checked).toHaveLength(2);
    expect(JSON.parse(localStorage.getItem('property-offer-analyser.buyer.v1')!)).toEqual({ name: 'Sam' });

    // Another house starts clean; coming back finds what was saved.
    f.componentRef.setInput('houseId', 'PE1 2QA|15A');
    f.detectChanges();
    expect(text(f)).toContain(`0 of ${boxes.length} done`);
    TestBed.resetTestingModule();
    const again = render(NextStepsView, inputs);
    expect(value(again, 'viewingNotes')).toBe('Damp in the back bedroom');
    expect(value(again, 'buyerName')).toBe('Sam');
  });

  it('writes the offer at the figure chosen and builds the send links', () => {
    const f = render(NextStepsView, inputs);
    expect(value(f, 'offerMessage')).toContain('I would like to offer £222,000');
    expect(value(f, 'offerMessage')).toContain('the updating the house needs and the 75 days');
    expect(value(f, 'offerMessage')).toContain('agreement in principle');
    button(f, 'Maximum').click();
    f.detectChanges();
    expect(value(f, 'offerMessage')).toContain('£246,000');
    enter(f, 'offerMessage', 'A different offer');
    const links = [...el(f).querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '');
    expect(links.filter((h) => h.startsWith('mailto:?subject='))).toHaveLength(2);
    expect(links.some((h) => h.startsWith('https://wa.me/?text=A%20different%20offer'))).toBe(true);
    expect(links.some((h) => h.includes('Viewing%20request%3A%2024%20Glebe%20Road'))).toBe(true);
  });

  it('copies a message and makes the calendar file', async () => {
    const f = render(NextStepsView, inputs);
    const copied: string[] = [];
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t: string) => void copied.push(t) }, configurable: true });
    button(f, 'Copy message').click();
    await new Promise((done) => setTimeout(done, 0));
    f.detectChanges();
    expect(copied[0]).toContain('I would like to view 24 Glebe Road');
    expect(text(f)).toContain('Copied');
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => Promise.reject(new Error('blocked')) }, configurable: true });
    button(f, 'Copy message').click(); // the first now reads "Copied", so this is the offer's button
    await new Promise((done) => setTimeout(done, 0)); // a blocked clipboard is ignored, not an error

    const calendar = button(f, 'Add to calendar') as HTMLButtonElement;
    expect(calendar.disabled).toBe(true);
    calendar.disabled = false;
    calendar.click(); // no time chosen: nothing is made
    const made: Blob[] = [];
    const realCreate = URL.createObjectURL;
    const realRevoke = URL.revokeObjectURL;
    URL.createObjectURL = ((b: Blob) => (made.push(b), 'blob:test')) as typeof URL.createObjectURL;
    URL.revokeObjectURL = (() => undefined) as typeof URL.revokeObjectURL;
    const clicks: string[] = [];
    const realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      clicks.push(this.download);
    };
    try {
      expect(made).toHaveLength(0);
      enter(f, 'viewingSlot1', '2026-11-28T10:30');
      button(f, 'Add to calendar').click();
      expect(made).toHaveLength(1);
      expect(clicks).toEqual(['viewing.ics']);
      expect(await made[0].text()).toContain('DTSTART:20261128T103000');
      await new Promise((done) => setTimeout(done, 1100)); // the temporary link is released a second later
    } finally {
      URL.createObjectURL = realCreate;
      URL.revokeObjectURL = realRevoke;
      HTMLAnchorElement.prototype.click = realClick;
    }
  });

  it('leaves out the offer when there are no offer figures, and survives broken or blocked storage', () => {
    localStorage.setItem('property-offer-analyser.viewings.v1', '{broken');
    const f = render(NextStepsView, { ...inputs, ladder: null, facts: { ...facts, inputs: { ...DEFAULT_INPUTS, useMortgage: false } } });
    expect(el(f).querySelector('#offerMessage')).toBeNull();
    expect(text(f)).toContain('Book a viewing');
    TestBed.resetTestingModule();
    Object.defineProperty(globalThis, 'localStorage', { value: { getItem: () => null, setItem: () => { throw new Error('full'); } }, configurable: true });
    const blocked = render(NextStepsView, inputs);
    enter(blocked, 'buyerName', 'Sam');
    expect(value(blocked, 'offerMessage')).toContain('Sam');
  });
});
