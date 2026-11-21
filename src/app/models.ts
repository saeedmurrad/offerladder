export type PropertyType = 'terraced' | 'semi-detached' | 'detached' | 'flat-maisonette' | 'other';
export type SdltMode = 'standard' | 'firstHome' | 'additional';

export interface Inputs {
  houseNumber: string;
  street: string;
  postcode: string;
  asking: number | null;
  propertyType: PropertyType;
  bedrooms: number | null;
  floorArea: number | null;
  listedDate: string;
  rentPcm: number | null;

  sdltMode: SdltMode;
  nonResident: boolean;
  useMortgage: boolean;
  ltvPct: number;
  ratePct: number;
  lenderFees: number;

  heating: 'gas' | 'electric' | 'none' | 'unknown';
  epc: 'ABC' | 'D' | 'E' | 'FG' | 'unknown';
  condition: 'refurbished' | 'average' | 'dated' | 'needsWork';
  bathroomDownstairs: boolean;
  boxRoom: boolean;
  customAdjustPct: number;
  /** offStreet: a drive, garage or allocated space. onStreet: none of its own. */
  parking: 'unknown' | 'offStreet' | 'onStreet';

  legal: number;
  survey: number;
  initialWorks: number;
  licenceFee: number;
  voidWeeks: number;
  managementPct: number;
  maintenancePct: number;
  insurancePa: number;
  compliancePa: number;

  targetNetYieldPct: number;
  monthsBack: number;
  wideSearch: boolean;
  sellerWorks: number;
}

export const DEFAULT_INPUTS: Inputs = {
  houseNumber: '',
  street: '',
  postcode: '',
  asking: null,
  propertyType: 'terraced',
  bedrooms: null,
  floorArea: null,
  listedDate: '',
  rentPcm: null,
  sdltMode: 'additional',
  nonResident: false,
  useMortgage: false,
  ltvPct: 75,
  ratePct: 5.8,
  lenderFees: 1500,
  heating: 'unknown',
  epc: 'unknown',
  condition: 'average',
  bathroomDownstairs: false,
  boxRoom: false,
  customAdjustPct: 0,
  parking: 'unknown',
  legal: 1500,
  survey: 600,
  initialWorks: 0,
  licenceFee: 0,
  voidWeeks: 3,
  managementPct: 12,
  maintenancePct: 8,
  insurancePa: 250,
  compliancePa: 365,
  targetNetYieldPct: 5,
  monthsBack: 24,
  wideSearch: false,
  sellerWorks: 0,
};

export interface Geo {
  postcode: string;
  outcode: string;
  lat: number;
  lng: number;
  ward: string;
  district: string;
  districtCode: string;
  country: string;
  lsoa: string;
  lsoaCode: string;
}

export interface Sale {
  paon: string;
  saon: string;
  street: string;
  postcode: string;
  price: number;
  date: string; // yyyy-mm-dd
  type: PropertyType;
  standard: boolean; // Land Registry category A (ordinary market sale)
  distanceM: number | null;
}

export interface Comp extends Sale {
  id: string;
  selected: boolean;
  m2: number | null;
}

export interface CrimeSummary {
  month: string;
  total: number;
  top: { category: string; count: number }[];
  /** Burglaries and vehicle crimes in the month: the two that bear most on a home. */
  burglary: number;
  vehicle: number;
  /** Crimes within the same mile in the same month a year earlier; null when that month could not be read. */
  yearAgo: number | null;
}

export interface FloodSummary {
  areas: string[];
}

/** Official UK House Price Index for the council area (HM Land Registry / ONS). */
export interface Hpi {
  month: string; // yyyy-mm
  average: number;
  annualChangePct: number | null;
  byType: Partial<Record<PropertyType, number>>;
}

/** A place near the house, from OpenStreetMap. distanceM is in a straight line. */
export interface Place {
  name: string;
  lat: number;
  lng: number;
  distanceM: number;
}

/** Ofsted's latest inspection result for a school, in words. */
export interface OfstedResult {
  text: string;
  /** Month of the inspection, such as "Mar 2026". */
  inspected: string;
  /** "in special measures" and the like, or ''. */
  concern: string;
  /** True for a result below "good" or "expected", or a category of concern. */
  weak: boolean;
  /** The inspection was of the school this one replaced, as when a school becomes an academy. */
  former: boolean;
}

export interface School extends Place {
  /** The Department for Education's reference number, which links to the school's official record and Ofsted reports. */
  urn: string | null;
  phase: 'Primary' | 'Secondary' | 'All-through' | 'Nursery' | 'Middle' | 'Sixth form' | '';
  ages: string;
  /** Academy, community school, special school and so on. */
  kind: string;
  independent: boolean;
  /** The fields below come from the official register only; they are empty when the school was read from the map. */
  pupils: number | null;
  gender: 'boys' | 'girls' | '';
  selective: boolean;
  faith: string;
  ofsted: OfstedResult | null;
  /** Schools in Wales are inspected by Estyn, not Ofsted. */
  wales: boolean;
}

export interface Station extends Place {
  kind: 'Rail' | 'Metro or tram';
}

export interface Hospital extends Place {
  /** Marked on the map as having an emergency department. */
  emergency: boolean;
}

export interface CarPark extends Place {
  fee: 'yes' | 'no' | null;
  capacity: number | null;
}

/** When the data that ships with the app was last built, and how current its sources are. */
export interface PlacesMeta {
  schoolsDate?: string;
  ofstedAsAt?: string;
  stationsBuilt?: string;
  hospitalsBuilt?: string;
}

/** What is around the house. Lists are nearest first. */
export interface Places {
  /** True when schools, stations and hospitals came from the official data that ships with the app, false when read from the map. */
  official: boolean;
  /** False when the lookup for places within walking distance failed: its lists are then empty, not "none nearby". */
  nearOk: boolean;
  /** The same for stations and hospitals, which are looked for much further out. */
  farOk: boolean;
  schools: School[];
  schoolCount: number;
  carParks: CarPark[];
  stations: Station[];
  hospitals: Hospital[];
  emergency: Hospital | null;
  doctors: Place[];
  pharmacy: Place | null;
  supermarket: Place | null;
  supermarketCount: number;
  park: Place | null;
  busStops: number;
}

/** A journey by road or footpath. */
export interface Route {
  metres: number;
  minutes: number;
}

/** Journeys from the house to the nearest station and the nearest emergency hospital. Null where no route was found. */
export interface Journeys {
  stationWalk: Route | null;
  stationDrive: Route | null;
  hospitalDrive: Route | null;
}

export interface AreaData {
  crime: CrimeSummary | null;
  flood: FloodSummary | null;
  hpi: Hpi | null;
}

/** One month of the UK House Price Index for an area. */
export interface HpiMonth {
  month: string; // yyyy-mm
  average: number;
  index: number;
  byType: Partial<Record<PropertyType, number>>;
  /** Sales registered that month; null for the newest months, which are not counted yet. */
  sales: number | null;
  newBuild: number | null;
}

/** The figures behind the demand outlook for one area, oldest first. */
export interface AreaSeries {
  hpi: HpiMonth[];
  /** [year, residents] from the mid-year estimates. */
  population: [number, number][];
  /** [year, median gross annual pay of full-time workers who live in the area]. */
  earnings: [number, number][];
  /** [yyyy-mm, claimants as a percentage of residents aged 16 to 64]. */
  claimants: [string, number][];
}

/** A council area and its country, side by side. */
export interface DemandData {
  areaName: string;
  countryName: string;
  area: AreaSeries;
  country: AreaSeries;
}

/** One analysed house, frozen at the moment it was added to the comparison. */
export interface Snapshot {
  id: string;
  label: string;
  savedAt: string;
  inputs: Inputs;
  district: string;
  basis: 'perM2' | 'sizeAdjusted' | 'price' | 'ownSale';
  low: number;
  mid: number;
  high: number;
  open: number;
  target: number;
  ceiling: number;
  adjustPct: number;
  compsUsed: number;
  netYieldAtTarget: number | null;
  netIncome: number | null;
  cashAtTarget: number | null;
  daysListed: number | null;
  sellerPaid: number | null;
  sellerYears: number | null;
  crimeTotal: number | null;
  floodAreas: number | null;
  hpiChangePct: number | null;
  stationM: number | null;
}
