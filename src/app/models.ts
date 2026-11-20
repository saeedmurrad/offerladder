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

/** Nearby places from OpenStreetMap. */
export interface Amenities {
  station: { name: string; distanceM: number } | null;
  schools: number;
  supermarkets: number;
}

export interface AreaData {
  crime: CrimeSummary | null;
  flood: FloodSummary | null;
  hpi: Hpi | null;
  amenities: Amenities | null;
}

/** One analysed house, frozen at the moment it was added to the comparison. */
export interface Snapshot {
  id: string;
  label: string;
  savedAt: string;
  inputs: Inputs;
  district: string;
  basis: 'perM2' | 'sizeAdjusted' | 'price';
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
