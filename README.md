# Property Offer Analyser

Enter a house in England or Wales and get a value range from nearby sold prices, the rental return, and three offer figures: where to open, where to aim and where to stop.

It is a static Angular 21 app (standalone components, signals) styled with Tailwind CSS 4, with light and dark themes and a phone layout. All data is read live in the browser from public open-data services, so there is no server and nothing is stored anywhere except your own browser.

## What it does

1. **Finds the house.** Postcode lookup gives the ward, council area and coordinates. With a house number it shows that house's own sale history and what the seller paid.
2. **Pulls comparables.** Every sale of the same property type in the nearest postcodes (about 400 m in a town; wider on request) over the last 24 months, from HM Land Registry. Each one can be ticked in or out. Price outliers start unticked.
3. **Values it.** Lower quartile, median and upper quartile of the comparables, adjusted for heating, EPC, condition and layout. If comparables have floor areas, the value is worked out per m² against the subject's floor area; otherwise on price alone, with a warning.
4. **Builds the offer ladder.**
   - Open: 5% under the low end, leaving room to move.
   - Aim for: halfway between the low end and the middle.
   - Maximum: the middle value. Above it the nearby sales no longer support the price.
   - None of the three goes above the asking price.
5. **Works out the rental return.** Stamp duty for the chosen buyer type, cash in, gross and net yield, optional mortgage cash flow, and the highest price that still meets a target net yield.
6. **Reads the seller's position.** Short ownership: an estimated break-even. Long ownership: no break-even pressure. Days on the market if a listing date is given.
7. **Adds area context.** The official UK House Price Index for the council area, crimes recorded within a mile in the latest month, Environment Agency flood areas within 1 km, the nearest station, schools and supermarkets, and links to the EPC register, rent listings, licensing, flood check and title register.
8. **Compares up to three houses.** Add analysed houses to a shortlist, see them side by side, which is best for what, and one pick with its reasons. Scoring: price against nearby sales 30, rental return 25, cash needed 10, space for the money 10, condition 10, crime 10, days on the market 5; small gaps count for less than large ones.
9. **Explains the jargon.** A searchable glossary of about 60 property terms in plain English.

## Floor areas

Land Registry does not record the size of a house, and the government EPC API cannot be called from a browser. If you enter the house's own floor area, the tool scales nearby sale prices to it using a typical floor area for the property type (an estimate, and flagged as one). With no floor area at all it compares prices only, which mixes large and small houses.

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
| Stations, schools, supermarkets | [OpenStreetMap](https://www.openstreetmap.org/copyright) via the Overpass API |

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
npx ng build
```

The calculation logic is in `src/app/engine.ts` and is covered by `src/app/app.spec.ts`. Data access is in `src/app/data.service.ts`. Design tokens and component classes are in `src/styles.css`; the icon set and the value bar are in `src/app/ui/`.

## Deployment

Every push to `main` runs the tests, builds the app and publishes it to GitHub Pages (`.github/workflows/deploy.yml`).
