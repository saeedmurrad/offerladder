import { gbp } from './format';
import { Inputs } from './models';

/**
 * What a buyer does after reading the report: ask for a viewing, look at the right things there, and put the offer in writing.
 * Everything here is plain text the buyer can change before sending. Nothing is sent by the app itself.
 */

export interface ViewingRequest {
  address: string;
  /** Preferred times as the buyer typed them into date-and-time fields: yyyy-mm-ddThh:mm. Empty entries are ignored. */
  slots: string[];
  name: string;
}

/** "Sat 28 Nov at 10:30" from a date-and-time field value. */
export function slotLabel(slot: string): string {
  const d = new Date(slot);
  if (!slot || isNaN(d.getTime())) return '';
  const day = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  return `${day} at ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}

export function viewingMessage(r: ViewingRequest): string {
  const times = r.slots.map(slotLabel).filter(Boolean);
  const when =
    times.length > 1
      ? `Would any of these times work?\n${times.map((t) => `- ${t}`).join('\n')}`
      : times.length === 1
        ? `Would ${times[0]} work?`
        : 'Please let me know which times are available this week.';
  return [`Hello,`, `I would like to view ${r.address}.`, when, `If none of those suits, please suggest another time.`, `Thank you${r.name.trim() ? `,\n${r.name.trim()}` : '.'}`].join('\n\n');
}

export interface HouseFacts {
  inputs: Inputs;
  /** Flood alert or warning areas within 1 km; null when not known. */
  floodAreas: number | null;
  /** Years the seller has owned it; null when not known. */
  sellerYears: number | null;
  daysListed: number | null;
}

/** What to look at and ask on the viewing: the points that matter for this house first, then the ones that matter for any house. */
export function viewingChecklist(f: HouseFacts): string[] {
  const i = f.inputs;
  const out: string[] = [];
  if (f.daysListed !== null && f.daysListed >= 60) out.push(`Ask why it has been on the market for ${f.daysListed} days, and whether any offers or sales have fallen through.`);
  if (f.sellerYears !== null && f.sellerYears < 3) out.push('The seller has owned it for under three years: ask what work was done, who did it, and for the certificates and guarantees.');
  if (i.condition === 'refurbished') out.push('Refurbished: ask for the electrical certificate, gas safety certificate and building control sign-off for any structural work.');
  if (i.condition === 'dated' || i.condition === 'needsWork') out.push('Needs work: note the age of the kitchen, bathroom, windows, wiring and boiler, so you can price the job.');
  if (i.heating === 'electric' || i.heating === 'none') out.push('No gas central heating: ask whether there is a gas supply to the house and what the heating costs to run.');
  if (i.heating === 'gas' || i.heating === 'unknown') out.push('Find the boiler: ask its age and when it was last serviced.');
  if (i.epc === 'E' || i.epc === 'FG') out.push(`EPC ${i.epc === 'FG' ? 'F or G' : 'E'}: look at the insulation, windows and heating, and ask what the certificate recommends.`);
  if (f.floodAreas) out.push('It is near a flood alert area: ask whether the house or street has ever flooded, and check what buildings insurance would cost.');
  if (i.parking !== 'offStreet') out.push('Parking: see how full the street is in the evening, and ask about residents\' permits.');
  if (i.propertyType === 'flat-maisonette') out.push('Flat: ask the years left on the lease, the ground rent, the service charge, and whether any major works are planned.');
  if (i.bathroomDownstairs) out.push('Bathroom downstairs: check whether a bathroom could be added upstairs, and where the soil pipe runs.');
  out.push(
    'Look for damp: stains on ceilings and around windows, a musty smell, peeling paint low on walls.',
    'Look for cracks wider than a coin, inside and out, and doors or windows that stick.',
    'Look at the roof, gutters and chimney from the street and the garden.',
    'Run the taps and shower to check the water pressure, and try the phone signal in each room.',
    'Ask what is included in the sale, why the seller is moving, and whether they have found somewhere to go.',
  );
  return out;
}

export interface OfferDraft {
  address: string;
  amount: number;
  asking: number | null;
  /** True for a cash buyer, false when buying with a mortgage. */
  cash: boolean;
  /** Reasons the price is below asking, each a short clause. Taken from the buyer's own answers about the house. */
  reasons: string[];
  name: string;
}

/**
 * The offer in writing. It gives the figure, the buyer's position and the reasons, and never the buyer's maximum:
 * an agent who knows the ceiling negotiates up to it.
 */
export function offerMessage(o: OfferDraft): string {
  const below = o.asking && o.amount < o.asking;
  const why = o.reasons.length
    ? `The figure reflects recent sold prices of similar homes nearby, and ${o.reasons.length === 1 ? o.reasons[0] : `${o.reasons.slice(0, -1).join(', ')} and ${o.reasons[o.reasons.length - 1]}`}.`
    : 'The figure reflects recent sold prices of similar homes nearby.';
  return [
    `Hello,`,
    `Following my viewing of ${o.address}, I would like to offer ${gbp(o.amount)}, subject to contract and survey.`,
    below ? why : null,
    o.cash ? 'I am a cash buyer and can send proof of funds.' : 'I am buying with a mortgage and can send my agreement in principle.',
    'I can instruct a solicitor straight away. If the offer is accepted, I would ask for the property to be taken off the market.',
    `Please confirm that you have passed this offer to the seller.`,
    `Thank you${o.name.trim() ? `,\n${o.name.trim()}` : '.'}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** Reasons a buyer can give for a lower offer, from their own answers about the house. */
export function offerReasons(i: Inputs, daysListed: number | null): string[] {
  const out: string[] = [];
  if (i.condition === 'needsWork') out.push('the work the house needs');
  if (i.condition === 'dated') out.push('the updating the house needs');
  if (i.heating === 'electric' || i.heating === 'none') out.push('the lack of gas central heating');
  if (i.epc === 'E' || i.epc === 'FG') out.push(`its EPC rating of ${i.epc === 'FG' ? 'F or G' : 'E'}`);
  if (i.bathroomDownstairs) out.push('the downstairs bathroom');
  if (i.parking === 'onStreet') out.push('the lack of parking');
  if (daysListed !== null && daysListed >= 60) out.push(`the ${daysListed} days it has been on the market`);
  return out;
}

const stamp = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}00`;
const escapeIcs = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');

/** A calendar entry for the viewing, as a file any phone or computer calendar opens. Times are the buyer's local time. */
export function viewingCalendarFile(address: string, slot: string, notes: string[], minutes = 30): string | null {
  const start = new Date(slot);
  if (!slot || isNaN(start.getTime())) return null;
  const end = new Date(start.getTime() + minutes * 60_000);
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//OfferLadder//Viewing//EN',
    'BEGIN:VEVENT',
    `UID:${stamp(start)}-${address.replace(/[^a-z0-9]/gi, '').slice(0, 30)}@offerladder`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${escapeIcs(`Viewing: ${address}`)}`,
    `LOCATION:${escapeIcs(address)}`,
    `DESCRIPTION:${escapeIcs(notes.map((n) => `- ${n}`).join('\n'))}`,
    'BEGIN:VALARM',
    'TRIGGER:-PT1H',
    'ACTION:DISPLAY',
    'DESCRIPTION:Viewing in one hour',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

export const emailLink = (subject: string, body: string, to = '') => `mailto:${encodeURIComponent(to.trim())}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
export const whatsAppLink = (body: string) => `https://wa.me/?text=${encodeURIComponent(body)}`;

export interface SummaryPoint {
  tone: 'good' | 'bad' | 'info';
  text: string;
}

/** What the rest of the report found, for the short list under the offer. Every field is optional: a missing one adds no line. */
export interface SummaryFacts {
  stance: 'above' | 'top' | 'fair' | 'below' | null;
  asking: number | null;
  /** What the seller paid and when (yyyy-mm-dd), and how long ago in years. */
  sellerPaid: number | null;
  sellerPaidDate: string | null;
  sellerYears: number | null;
  daysListed: number | null;
  netYieldAtTarget: number | null;
  targetYield: number;
  stationName: string | null;
  stationWalkMinutes: number | null;
  /** Schools within a mile, and how many of those have a good or better Ofsted result. */
  schools: number | null;
  schoolsGood: number | null;
  demand: 'building' | 'mixed' | 'easing' | 'unknown' | null;
  district: string;
  floodAreas: number | null;
  crimeNow: number | null;
  crimeYearAgo: number | null;
  epc: Inputs['epc'];
  parking: Inputs['parking'];
}

const monthYear = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });

/** The report in a handful of plain lines: the things that should change what the buyer does, good and bad. */
export function summaryPoints(f: SummaryFacts): SummaryPoint[] {
  const out: SummaryPoint[] = [];
  if (f.stance === 'above' && f.asking) out.push({ tone: 'bad', text: `The asking price of ${gbp(f.asking)} is more than the evidence supports. Expect to negotiate.` });
  if (f.stance === 'below' && f.asking) out.push({ tone: 'info', text: `The asking price of ${gbp(f.asking)} is below what similar homes sold for. Find out why before treating it as a bargain.` });
  if (f.stance === 'fair' && f.asking) out.push({ tone: 'good', text: `The asking price of ${gbp(f.asking)} is in line with what similar homes sold for.` });
  if (f.sellerPaid && f.sellerPaidDate && f.sellerYears !== null && f.sellerYears < 3) {
    out.push({ tone: 'info', text: `The seller paid ${gbp(f.sellerPaid)} in ${monthYear(f.sellerPaidDate)}, so an offer far below that is likely to be refused.` });
  }
  if (f.daysListed !== null && f.daysListed >= 60) out.push({ tone: 'good', text: `It has been for sale for ${f.daysListed} days, which gives you room to offer low.` });
  if (f.daysListed !== null && f.daysListed < 21) out.push({ tone: 'info', text: `It has been for sale for only ${f.daysListed} days. Sellers rarely accept low offers this early.` });
  if (f.netYieldAtTarget !== null) {
    const meets = f.netYieldAtTarget >= f.targetYield;
    out.push({ tone: meets ? 'good' : 'bad', text: `As a rental it returns ${f.netYieldAtTarget.toFixed(1)}% a year after costs at the price to aim for, ${meets ? 'which meets' : 'short of'} your ${f.targetYield}% target.` });
  }
  if (f.stationName && f.stationWalkMinutes !== null) {
    out.push({ tone: f.stationWalkMinutes <= 15 ? 'good' : 'info', text: `${f.stationName} station is ${f.stationWalkMinutes} minutes on foot.` });
  }
  if (f.schools !== null && f.schoolsGood !== null && f.schools > 0) {
    out.push({ tone: f.schoolsGood > 0 ? 'good' : 'info', text: `${f.schools} school${f.schools === 1 ? '' : 's'} within a mile, ${f.schoolsGood} with a good or better Ofsted result.` });
  }
  if (f.demand === 'building') out.push({ tone: 'good', text: `Demand in ${f.district} is building: more signs point up than down.` });
  if (f.demand === 'easing') out.push({ tone: 'bad', text: `Demand in ${f.district} is easing: more signs point down than up.` });
  if (f.floodAreas) out.push({ tone: 'bad', text: `It is within 1 km of ${f.floodAreas} flood alert area${f.floodAreas === 1 ? '' : 's'}. Run the flood check for the exact address and get an insurance quote.` });
  if (f.crimeNow !== null && f.crimeYearAgo && f.crimeNow > f.crimeYearAgo * 1.1) {
    out.push({ tone: 'bad', text: `Recorded crime within a mile is ${Math.round((f.crimeNow / f.crimeYearAgo - 1) * 100)}% higher than a year ago.` });
  }
  if (f.epc === 'FG') out.push({ tone: 'bad', text: 'An EPC of F or G cannot legally be let as it stands, and will cost money to improve.' });
  if (f.parking === 'onStreet') out.push({ tone: 'info', text: 'It has no parking of its own.' });
  return out;
}
