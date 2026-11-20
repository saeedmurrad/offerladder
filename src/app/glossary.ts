export interface Term {
  term: string;
  group: 'Prices and value' | 'The buying process' | 'Money and tax' | 'Renting it out' | 'Ownership and legal' | 'Condition and surveys' | 'The area';
  meaning: string;
  why?: string;
}

/** Plain-English property terms for England and Wales. Rules change: check gov.uk before relying on a figure. */
export const GLOSSARY: Term[] = [
  // Prices and value
  { term: 'Asking price', group: 'Prices and value', meaning: 'The price the seller advertises. It is an opening position, not a valuation.', why: 'Compare it with what similar houses actually sold for before deciding what to offer.' },
  { term: 'Guide price', group: 'Prices and value', meaning: 'A range or figure showing roughly what the seller hopes for. Common at auctions, where the reserve can be up to 10% above the guide.' },
  { term: 'Offers over / OIEO', group: 'Prices and value', meaning: '"Offers over" or "offers in excess of" asks for bids above the stated figure. You are still free to offer less.' },
  { term: 'Comparable (comp)', group: 'Prices and value', meaning: 'A recent sale of a similar property nearby, used as evidence of value. Good comparables match on type, size, street and date.', why: 'Surveyors and lenders value this way, so your offer should too.' },
  { term: 'Price per m²', group: 'Prices and value', meaning: 'Sale price divided by internal floor area. It lets you compare houses of different sizes fairly.', why: 'A small house can look cheap on price and still be expensive per m².' },
  { term: 'Sold price (price paid)', group: 'Prices and value', meaning: 'The price recorded by HM Land Registry when a sale completes. It is public for every sale since 1995 and usually appears two to three months after completion.' },
  { term: 'Below market value (BMV)', group: 'Prices and value', meaning: 'A purchase agreed under what comparables support, usually because the seller needs speed or certainty.' },
  { term: 'Down-valuation', group: 'Prices and value', meaning: 'When the mortgage lender\'s valuer says the property is worth less than the agreed price. The lender then lends against the lower figure.', why: 'You must renegotiate, find the difference in cash, or walk away.' },
  { term: 'UK House Price Index (HPI)', group: 'Prices and value', meaning: 'The official monthly measure of average prices by council area, published by HM Land Registry and the ONS.', why: 'It shows whether the local market is rising or falling.' },
  { term: 'Days on the market', group: 'Prices and value', meaning: 'How long a property has been listed. Long listings and price reductions suggest the asking price is too high and give a buyer leverage.' },

  // The buying process
  { term: 'Subject to contract (STC)', group: 'The buying process', meaning: 'An offer or acceptance that is not yet legally binding. In England and Wales nothing is binding until contracts are exchanged.' },
  { term: 'Sold STC / under offer', group: 'The buying process', meaning: 'The seller has accepted an offer but contracts have not been exchanged. The sale can still fall through.' },
  { term: 'Chain', group: 'The buying process', meaning: 'A line of linked sales where each depends on the one before. "No chain" or "chain free" means the seller is not buying onward, so the sale can move faster.' },
  { term: 'Proof of funds', group: 'The buying process', meaning: 'Evidence that you can pay: bank statements for a cash buyer, or a mortgage agreement in principle plus proof of deposit.', why: 'Agents rank offers by certainty, so having it ready strengthens a lower offer.' },
  { term: 'Agreement in principle (AIP)', group: 'The buying process', meaning: 'A lender\'s written statement of how much it would be prepared to lend you, based on a basic check. It is not a mortgage offer.' },
  { term: 'Memorandum of sale', group: 'The buying process', meaning: 'The agent\'s document confirming the agreed price and the buyer, seller and solicitor details. It starts the legal work.' },
  { term: 'Conveyancing', group: 'The buying process', meaning: 'The legal work of transferring ownership, done by a solicitor or licensed conveyancer: checking the title, raising enquiries, searches, contracts and registration.' },
  { term: 'Searches', group: 'The buying process', meaning: 'Checks your solicitor orders from the council, water company and environmental data providers: planning, roads, drainage, flooding, contamination.' },
  { term: 'Exchange of contracts', group: 'The buying process', meaning: 'The point where the sale becomes legally binding and the completion date is fixed. The buyer normally pays a 10% deposit.', why: 'After exchange, pulling out means losing the deposit.' },
  { term: 'Completion', group: 'The buying process', meaning: 'The day the balance is paid, ownership transfers and you get the keys.' },
  { term: 'Gazumping', group: 'The buying process', meaning: 'When the seller accepts a higher offer from someone else after accepting yours, before exchange.' },
  { term: 'Gazundering', group: 'The buying process', meaning: 'When a buyer lowers their offer just before exchange, relying on the seller not wanting to start again.' },

  // Money and tax
  { term: 'Stamp Duty Land Tax (SDLT)', group: 'Money and tax', meaning: 'Tax paid by the buyer in England and Northern Ireland, charged in bands on the price: nothing up to £125,000, 2% from there to £250,000, 5% to £925,000, then higher.', why: 'It is due within 14 days of completion and comes out of your cash.' },
  { term: 'Additional dwelling surcharge', group: 'Money and tax', meaning: 'An extra 5% SDLT on the whole price when you will own more than one residential property after buying, or when a company buys. For joint buyers it applies if any one of them owns a home anywhere in the world.' },
  { term: 'First-time buyer relief', group: 'Money and tax', meaning: 'No SDLT up to £300,000 and 5% from there to £500,000, if every buyer has never owned a home and will live in the property.' },
  { term: 'Loan to value (LTV)', group: 'Money and tax', meaning: 'The mortgage as a percentage of the property\'s value. A £150,000 house with a £112,500 loan is 75% LTV. Lower LTV usually means a lower interest rate.' },
  { term: 'Buy-to-let mortgage', group: 'Money and tax', meaning: 'A mortgage for a property you will rent out. It usually needs a deposit of at least 25%, is often interest-only, and is assessed mainly on the rent.' },
  { term: 'Interest-only', group: 'Money and tax', meaning: 'You pay only the interest each month and still owe the full loan at the end. Payments are lower than on a repayment mortgage, but the debt does not shrink.' },
  { term: 'Rental stress test (ICR)', group: 'Money and tax', meaning: 'The lender\'s check that the rent covers the mortgage interest with room to spare, typically 125% to 145% of the interest worked out at a test rate.', why: 'A low rent can cap how much you are able to borrow.' },
  { term: 'Bridging loan', group: 'Money and tax', meaning: 'Short-term, expensive finance used to buy quickly, for example at auction, before refinancing or selling.' },
  { term: 'Section 24', group: 'Money and tax', meaning: 'The rule that individual landlords cannot deduct mortgage interest from rent before tax. They get a 20% tax credit on it instead. Companies are not affected.' },

  // Renting it out
  { term: 'Gross yield', group: 'Renting it out', meaning: 'A year\'s rent divided by the purchase price. £900 a month on a £135,000 house is 8%.', why: 'Quick to compare, but it ignores every cost.' },
  { term: 'Net yield', group: 'Renting it out', meaning: 'A year\'s rent after empty periods and running costs, divided by all the cash you put in, including stamp duty, fees and works.', why: 'This is the real return before tax and mortgage.' },
  { term: 'Cash flow', group: 'Renting it out', meaning: 'What is left each month after running costs and the mortgage payment.' },
  { term: 'Return on cash (ROI)', group: 'Renting it out', meaning: 'A year\'s cash flow divided by the cash you personally put in. A mortgage can raise it or wipe it out, depending on the interest rate.' },
  { term: 'Void', group: 'Renting it out', meaning: 'A period when the property is empty and earns nothing while council tax, insurance and any mortgage continue.' },
  { term: 'Selective licensing', group: 'Renting it out', meaning: 'A council scheme requiring every landlord in a named area to hold a licence for each rented house. Fees are often several hundred pounds for five years.', why: 'Letting without one can bring a large fine and an order to repay rent.' },
  { term: 'HMO', group: 'Renting it out', meaning: 'House in multiple occupation: three or more people from more than one household sharing a kitchen or bathroom. A licence is compulsory with five or more people.' },
  { term: 'Article 4 direction', group: 'Renting it out', meaning: 'A council order removing the automatic right to turn a family house into a small HMO, so planning permission is needed first.' },
  { term: 'Periodic tenancy', group: 'Renting it out', meaning: 'A rolling tenancy with no fixed end date. Since May 2026 all private tenancies in England are periodic and "no-fault" Section 21 evictions are abolished.' },
  { term: 'Local Housing Allowance (LHA)', group: 'Renting it out', meaning: 'The maximum housing benefit for a private tenant, set by area and number of bedrooms.', why: 'If your rent is well above it, tenants on benefits cannot cover it.' },
  { term: 'Gas safety certificate', group: 'Renting it out', meaning: 'A yearly check by a Gas Safe engineer, legally required in every rented home with gas.' },
  { term: 'EICR', group: 'Renting it out', meaning: 'Electrical Installation Condition Report. Rented homes in England need a satisfactory one at least every five years.' },

  // Ownership and legal
  { term: 'Freehold', group: 'Ownership and legal', meaning: 'You own the building and the land outright, with no time limit. Most houses are freehold.' },
  { term: 'Leasehold', group: 'Ownership and legal', meaning: 'You own the property for a fixed number of years under a lease from the freeholder. Most flats are leasehold.', why: 'Short leases, ground rent and service charges all reduce value. Many lenders want around 80 years or more remaining.' },
  { term: 'Ground rent', group: 'Ownership and legal', meaning: 'A yearly payment from a leaseholder to the freeholder. Check the amount and whether it rises.' },
  { term: 'Service charge', group: 'Ownership and legal', meaning: 'The leaseholder\'s share of the cost of maintaining and insuring the building and shared areas.' },
  { term: 'Title register', group: 'Ownership and legal', meaning: 'HM Land Registry\'s record of who owns a property, the price last paid, and any mortgages or restrictions. Anyone can buy a copy for £7.' },
  { term: 'Flying freehold', group: 'Ownership and legal', meaning: 'Part of a freehold property that sits over or under a neighbour\'s land, such as a room above a shared passage. Some lenders will not lend on it.' },
  { term: 'Restrictive covenant', group: 'Ownership and legal', meaning: 'A rule attached to the title limiting what you can do, for example no extensions or no business use.' },

  // Condition and surveys
  { term: 'EPC rating', group: 'Condition and surveys', meaning: 'Energy Performance Certificate. It grades a home from A (most efficient) to G on a score of 1 to 100, and lists floor area, heating, insulation and suggested improvements. It lasts 10 years.', why: 'A rented home must be E or better now, and is due to need C by October 2030. A poor rating means higher bills and upgrade costs.' },
  { term: 'RICS Level 2 survey', group: 'Condition and surveys', meaning: 'A mid-range inspection by a chartered surveyor, formerly the HomeBuyer Report. Suited to conventional houses in reasonable condition.' },
  { term: 'RICS Level 3 survey', group: 'Condition and surveys', meaning: 'The fullest inspection, formerly a building survey. Suited to old, altered, unusual or run-down properties.' },
  { term: 'Mortgage valuation', group: 'Condition and surveys', meaning: 'A brief check for the lender that the property is adequate security for the loan. It is not a survey and may be done without a visit.' },
  { term: 'Solid wall', group: 'Condition and surveys', meaning: 'A wall with no cavity, usual in houses built before about 1920. It loses more heat, is expensive to insulate and is more prone to damp.' },
  { term: 'Building regulations sign-off', group: 'Condition and surveys', meaning: 'A completion certificate from building control showing that work such as an extension, rewiring or a new boiler met the rules. Ask for it on any refurbished house.' },

  // The area
  { term: 'Council tax band', group: 'The area', meaning: 'Bands A (lowest) to H in England, based on the property\'s value in 1991. The band sets the yearly bill.', why: 'A landlord pays it whenever the house is empty.' },
  { term: 'Flood risk', group: 'The area', meaning: 'The government publishes long-term risk from rivers, the sea and surface water for every address, graded very low to high.', why: 'High risk raises insurance costs and can stop a mortgage.' },
  { term: 'Index of Multiple Deprivation', group: 'The area', meaning: 'The official ranking of every small neighbourhood in England on income, employment, health, crime and housing. Decile 1 is the most deprived tenth.' },
  { term: 'Postcode sector', group: 'The area', meaning: 'A postcode minus its last two letters, such as "PE1 2". Sold-price statistics are often quoted at this level.' },
];

export const GROUPS = [...new Set(GLOSSARY.map((t) => t.group))];
