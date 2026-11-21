# OfferLadder

Developed by [SNA Tech](https://snatech.co.uk).

Enter a house in England or Wales and get a value range from nearby sold prices, the rental return, and three offer figures: where to open, where to aim and where to stop.

It is a static Angular 21 app (standalone components, signals) styled with Tailwind CSS 4, with light and dark themes and a phone layout. All data is read live in the browser from public open-data services, so there is no server and nothing is stored anywhere except your own browser.

## What it does

1. **Finds the house.** Postcode lookup gives the ward, council area and coordinates. With a house number it shows that house's own sale history and what the seller paid, and takes the property type from the house's own Land Registry record so it is compared with the right kind of house.
2. **Pulls comparables.** Every sale of the same property type in the nearest postcodes (about 400 m in a town; wider on request) over the last 24 months, from HM Land Registry. Each one can be ticked in or out. Price outliers start unticked.
3. **Values it.** Lower quartile, median and upper quartile of the comparables, adjusted for heating, EPC, condition and layout. If comparables have floor areas, the value is worked out per m² against the subject's floor area; otherwise on price alone, with a warning.
   - **The house's own last sale counts most.** If the house itself sold in the last 7.5 years, that price is moved to today with the UK House Price Index for the council area and blended into the value: 90% weight for a sale today, falling 12 points a year. The range narrows the same way, down to 5% either side. If nearby sales alone sit more than 15% away from the house's own sale, the report says so. With fewer than three comparables, the house's own sale is used alone.
4. **Builds the offer ladder.**
   - Open: 5% under the low end, leaving room to move.
   - Aim for: halfway between the low end and the middle.
   - Maximum: the middle value. Above it the nearby sales no longer support the price.
   - None of the three goes above the asking price.
   **Then says it in short and helps you act.** An "In short" list gives the handful of findings that should change what you do, marked as in your favour or a reason for care. "What to do next" writes the viewing request to the estate agent (copy, email or WhatsApp, and a calendar entry), gives a viewing checklist tailored to the house with room for notes, and writes the offer in writing at the opening, target or maximum figure. Nothing is sent by the app; the buttons open the buyer's own email or WhatsApp.
5. **Works out the rental return.** Stamp duty for the chosen buyer type, cash in, gross and net yield, optional mortgage cash flow, and the highest price that still meets a target net yield.
6. **Reads the seller's position.** Short ownership: an estimated break-even. Long ownership: no break-even pressure. Days on the market if a listing date is given.
7. **Checks the location.** Every school within a mile with its type, ages, pupil numbers and latest Ofsted result; the nearest station with the journey on foot and by car; the nearest emergency department with the drive. These come from official data that ships with the app, so they appear at once. Bus stops, public car parks (shown when the house has no parking of its own), GP, pharmacy, supermarkets and parks follow from the public map server, which can take up to a minute and can be retried if it does not answer.
   **And adds area context.** The official UK House Price Index for the council area, crimes recorded within a mile in the latest month against the same month a year earlier, Environment Agency flood areas within 1 km, and links to the EPC register, rent listings, licensing, flood check and title register.
8. **Reads the demand outlook.** Seven measures for the council area, each set against England or Wales: price growth for the property type, sales activity, population growth, new homes sold against new residents, price against earnings, earnings growth, and the claimant rate. Each is marked as pointing to rising demand, falling demand or level, and three more up than down (or down than up) gives the overall reading. The thresholds are in `src/app/demand.ts` (`DEMAND_RULES`). It reads the whole council area, not one house, and it is not a forecast.
9. **Has two stand-alone calculators.** A mortgage repayment calculator (price, deposit, term, rate: monthly payment, interest-only payment, total repaid and total interest) and a stamp duty calculator with a band-by-band breakdown. They start from the house being analysed and work without one.
10. **Compares up to three houses.** Add analysed houses to a shortlist, see them side by side, which is best for what, and one pick with its reasons. Scoring: price against nearby sales 30, rental return 25, cash needed 10, space for the money 10, condition 10, crime 10, days on the market 5; small gaps count for less than large ones.
11. **Explains the jargon.** A searchable glossary of about 60 property terms in plain English.

## Importing a listing

Paste the text of a Zoopla, Rightmove or OnTheMarket listing page (select all, copy) into "Import from a listing". A link on its own cannot be read: the app runs in the browser, and the portals do not let another website open their pages (Zoopla also refuses requests from servers). If a link is pasted, the app says so and offers to open the listing so its text can be copied. The tool reads the asking price, street, bedrooms, type, date listed, EPC, heating, condition and past sale prices, then matches the past sales against Land Registry to identify the house number and full postcode, which listings usually hide. The text is parsed in your browser; nothing is fetched from the portals.

## The "Send to OfferLadder" button

A property site will not let another website open its pages, so a link cannot be read. The buyer's own browser, though, already has the page open. "One-click button for your computer" in the import panel gives a bookmark to drag to the bookmarks bar. Clicked on a Zoopla, Rightmove or OnTheMarket listing, it reads that page (its text, photo addresses, floor plan and the full postcode held in the page's data) and opens OfferLadder with the listing imported and analysed.

- It is the buyer copying the page in one click. Nothing is fetched from the property site by this app or by any server.
- The listing travels in the address of the page it opens (`#import=...`) and is removed from the address once read.
- What arrives is treated as untrusted: only pictures on the three sites' own picture servers are shown, and only a listing address on those sites is linked.
- Photos and floor plans load from the property site into the browser. They are not stored, and they are left out when printing.
- It works on a computer. On a phone, use the browser's Share button and paste what it gives: the headline is enough for the price, street, bedrooms and type.

The script is `collectListing` in `src/app/send-button.ts`. It has to stand alone, because its own text is what the bookmark holds.

## Data that ships with the app

Schools, Ofsted results, stations and hospitals are read from files in `public/data/places/`, not from a live service, so the Location section is quick and does not depend on anyone else's server. Schools are split into squares of half a degree, and the app loads only the one to four squares around the house.

Refresh them about once a month and commit what changes:

```bash
node scripts/build-places-data.mjs
```

The script downloads each source fresh (about 80 MB in all), needs Node 20 or later and no packages, and leaves an existing file untouched if its source cannot be reached. `public/data/places/meta.json` records how current each source is, and the report shows those dates. If the files cannot be read, the app falls back to OpenStreetMap for everything.

## Floor areas

Land Registry does not record the size of a house, and the government EPC API cannot be called from a browser. If you enter the house's own floor area, the tool scales nearby sale prices to it using a typical floor area for the property type (an estimate, and flagged as one). With no floor area but a bedroom count, it assumes a typical size for that many bedrooms and says so. With neither, it compares prices only, which mixes large and small houses.

To compare like for like, open the "Add floor areas" panel in the report:

- paste rows copied from a sold-price table that includes m² (the panel links to one for the postcode sector), or
- type the m² into the comparables table.

Then press "Keep only similar size (±25%)". With four or more areas the valuation switches to price per m².

## Data sources

| Data | Source |
|---|---|
| Sold prices | [HM Land Registry price-paid data](https://landregistry.data.gov.uk/) (Open Government Licence) |
| Postcodes, wards, coordinates | [postcodes.io](https://postcodes.io/) |
| Crime | [data.police.uk](https://data.police.uk/) |
| Flood areas | [Environment Agency flood-monitoring API](https://environment.data.gov.uk/flood-monitoring/doc/reference) |
| Council-area price index | [UK House Price Index](https://landregistry.data.gov.uk/app/ukhpi) (HM Land Registry, ONS) |
| Sales counts, new-build sales, index by property type | [UK House Price Index](https://landregistry.data.gov.uk/app/ukhpi) (HM Land Registry, ONS) |
| Population, earnings, claimant count | [Nomis](https://www.nomisweb.co.uk/) (ONS): mid-year population estimates, Annual Survey of Hours and Earnings, claimant count |
| Schools | [Get Information About Schools](https://get-information-schools.service.gov.uk/) (Department for Education), shipped with the app |
| Ofsted results | [State-funded school inspections and outcomes](https://www.gov.uk/government/statistical-data-sets/monthly-management-information-ofsteds-school-inspections-outcomes) (Ofsted), shipped with the app |
| Stations | [NaPTAN](https://www.gov.uk/government/publications/national-public-transport-access-node-schema) (Department for Transport), shipped with the app |
| Hospitals | [NHS website datasets](https://www.nhs.uk/about-us/nhs-website-datasets/) (NHS England); emergency departments and Welsh hospitals from OpenStreetMap; shipped with the app |
| Car parks, GPs, shops, parks, bus stops | [OpenStreetMap](https://www.openstreetmap.org/copyright) via the Overpass API |
| Walking and driving journeys | OpenStreetMap routing ([FOSSGIS](https://routing.openstreetmap.de/)) |

Rent levels by council area (the ONS Price Index of Private Rents) are not published through an API a browser can call, so the demand outlook links to the ONS page for the area instead.

Zoopla, Rightmove and OnTheMarket do not offer a free public API and their terms prohibit scraping, so the tool links to their searches instead of reading them.

Stamp duty uses the England and Northern Ireland residential rates in `src/app/engine.ts` (`TAX`). Check them against [gov.uk](https://www.gov.uk/stamp-duty-land-tax/residential-property-rates) after every Budget. Wales (Land Transaction Tax) and Scotland are not calculated.

## Limits

- The adjustment percentages are rules of thumb, not a valuation model.
- Rent is your own input. Use live asking rents for similar houses, not a selling agent's figure.
- This is a calculation from public records and your inputs. It is not a survey, a formal valuation or financial advice.

## Development

```bash
npm install
```

```bash
npx ng serve
```

```bash
npx ng test --watch=false
```

```bash
npm run test:coverage
```

```bash
npx ng build
```

### Tests come first

New behaviour is written test-first: add a test that fails for the right reason, then the code that makes it pass, then tidy up. A bug gets a test that reproduces it before it gets a fix.

`npm run test:coverage` runs every test and then fails if coverage is under 80% on statements, branches, functions or lines. The figure counts every file under `src/app`, including any no test touches, so it cannot be flattered by leaving code out. The deploy workflow runs the same command, so a change that drops coverage below the floor does not go live. An HTML report is written to `coverage/offerladder/`.

| Tests | Cover |
|---|---|
| `src/app/app.spec.ts` | The calculations: valuation, offers, stamp duty, mortgage, demand outlook, listing reader, places, messages, the browser button |
| `src/app/data.service.spec.ts` | Every lookup, with the network faked: postcodes, Land Registry, price index, Nomis, crime, flood, map server, journeys, bundled files |
| `src/app/app.component.spec.ts` | The main screen: analysing, importing, comparing, late and failed lookups |
| `src/app/ui/views.spec.ts` | The calculators, comparison, glossary, viewing and offer messages, value bar |

The calculation logic is in `src/app/engine.ts` and is covered by `src/app/app.spec.ts`. Data access is in `src/app/data.service.ts`. Design tokens and component classes are in `src/styles.css`; the icon set and the value bar are in `src/app/ui/`.

## Deployment

Every push to `main` runs the tests, builds the app and publishes it to GitHub Pages (`.github/workflows/deploy.yml`).
