/**
 * The "Send to OfferLadder" browser button.
 *
 * A property site will not let another website open its pages, but the buyer's own browser has the page open already.
 * The button is a bookmark holding a few lines of script. Clicked on a listing, it reads what is on that page (the text,
 * the photo addresses, the floor plan and the postcode) and opens OfferLadder with it. It is the buyer copying the page,
 * done in one click; nothing is fetched from the property site by this app or by any server.
 */

/** What the button sends, kept short because it travels in the address of the page it opens. */
interface Payload {
  v: 1;
  /** The listing's address on the web. */
  u: string;
  /** The page as text, as selecting it all and copying would give. */
  x: string;
  /** The postcode from the page's own data, when it has one. */
  p: string;
  /** Photo and floor plan addresses, one per picture. */
  i: string[];
  /** Zoopla names its floor plan images apart from the photos. */
  f: string[];
}

/**
 * Runs on the listing page. It must stand alone: no imports and nothing from outside its own body,
 * because its text is what gets stored in the bookmark. Plain syntax only, for the same reason.
 */
export function collectListing(app: string): void {
  const d = document;
  const best: Record<string, { u: string; score: number }> = {};
  const order: string[] = [];
  const hosts = /^https:\/\/[^/]*(zoocdn\.com|media\.rightmove\.co\.uk|media\.onthemarket\.com)\/.*\.(jpe?g|png|webp)$/i;
  // The same picture is on the page at several sizes: keep the largest of each.
  const add = (raw: string | null | undefined): void => {
    let u = String(raw || '')
      .trim()
      .split(/\s/)[0]
      .replace(/\\u002F/gi, '/')
      .replace(/\\\//g, '/')
      .replace(/:p$/, '');
    if (u.indexOf('//') === 0) u = 'https:' + u;
    u = u.replace(/^http:/, 'https:');
    if (!hosts.test(u)) return;
    const size = /_max_(\d+)x(\d+)|-(\d+)x(\d+)\.|\/(\d+)\/(\d+)\/[0-9a-f]{40}\./.exec(u);
    const score = size ? Number(size[1] || size[3] || size[5]) * Number(size[2] || size[4] || size[6]) : 9e9;
    const key = u
      .replace(/\/u\/\d+\/\d+\//, '/')
      .replace(/\/\d+\/\d+\/(?=[0-9a-f]{40}\.)/, '/')
      .replace('/dir/', '/')
      .replace(/_max_\d+x\d+/, '')
      .replace(/-(\d+x\d+|original)(?=\.)/, '')
      .replace(/\.\w+$/, '');
    if (!best[key]) {
      if (order.length >= 90) return;
      order.push(key);
      best[key] = { u, score };
    } else if (score > best[key].score) best[key] = { u, score };
  };
  const els = d.querySelectorAll('img,source');
  for (let n = 0; n < els.length; n++) {
    const e = els[n] as HTMLImageElement;
    add(e.currentSrc || e.src);
    (e.getAttribute('srcset') || '').split(',').forEach(add);
  }
  // Pictures further down the gallery are not on screen yet, but their addresses are in the page's data.
  const html = d.documentElement.innerHTML;
  const inData = /https?:(?:\\\/|\/){2}[^"'\\\s<>]*?(?:zoocdn\.com|media\.rightmove\.co\.uk|media\.onthemarket\.com)[^"'\s<>]*?\.(?:jpe?g|png|webp)/gi;
  let m: RegExpExecArray | null;
  while ((m = inData.exec(html))) add(m[0]);
  const plans: string[] = [];
  const plan = /floorPlan\\*":\{\\*"image\\*":\[\{[^\]]*?filename\\*":\\*"([0-9a-f]{40}\.\w+)/g;
  while ((m = plan.exec(html)) && plans.length < 6) if (plans.indexOf(m[1]) < 0) plans.push(m[1]);

  let postcode = '';
  try {
    const a = (window as unknown as { PAGE_MODEL: { propertyData: { address: { outcode: string; incode: string } } } }).PAGE_MODEL.propertyData.address;
    if (a.outcode && a.incode) postcode = a.outcode + ' ' + a.incode;
  } catch {
    /* not a Rightmove page */
  }
  if (!postcode) {
    const out = /outcode\\*"?:\\*"([A-Z]{1,2}\d[A-Z\d]?)\\*"/.exec(html);
    const inc = /incode\\*"?:\\*"(\d[A-Z]{2})\\*"/.exec(html);
    if (out && inc) postcode = out[1] + ' ' + inc[1];
  }
  if (!postcode) {
    const whole = /postcode\\*"?:\\*"([A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2})\\*"/.exec(html);
    if (whole) postcode = whole[1];
  }

  const data = { v: 1, u: location.href, x: (d.body.innerText || d.body.textContent || '').slice(0, 20000), p: postcode, i: order.map((k) => best[k].u), f: plans };
  const url = app + '#import=' + encodeURIComponent(JSON.stringify(data));
  if (!window.open(url, '_blank')) location.href = url;
}

/** The bookmark's address: the collector above, with this app's own address written in. */
export function bookmarklet(app: string): string {
  return 'javascript:' + encodeURIComponent(`(${collectListing.toString()})(${JSON.stringify(app)});`);
}

export interface ListingPhoto {
  url: string;
  floorPlan: boolean;
}

export interface SentListing {
  /** The listing's address on the web, only when it is on one of the three property sites. */
  url: string;
  site: 'Zoopla' | 'Rightmove' | 'OnTheMarket' | null;
  text: string;
  postcode: string | null;
  photos: ListingPhoto[];
}

const MAX_PHOTOS = 40;
const SITES: [RegExp, SentListing['site']][] = [
  [/(^|\.)zoopla\.co\.uk$/, 'Zoopla'],
  [/(^|\.)rightmove\.co\.uk$/, 'Rightmove'],
  [/(^|\.)onthemarket\.com$/, 'OnTheMarket'],
];
const IMAGE_HOSTS = /(^|\.)(zoocdn\.com|rightmove\.co\.uk|onthemarket\.com)$/;

/**
 * The pictures that belong to this listing, photos first and floor plans last.
 * Only addresses on the property sites' own picture servers are kept, since what arrives could have been written by anyone.
 */
export function listingPhotos(urls: string[], zooplaPlans: string[], pageUrl: string): ListingPhoto[] {
  const id = /\/(?:properties|details)\/(\d{5,})/.exec(pageUrl)?.[1];
  const planFiles = new Set(zooplaPlans.filter((f) => /^[0-9a-f]{40}\.\w{3,4}$/.test(f)));
  const out: ListingPhoto[] = [];
  for (const raw of urls) {
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      continue;
    }
    if (u.protocol !== 'https:' || !IMAGE_HOSTS.test(u.hostname) || !/\.(jpe?g|png|webp)$/i.test(u.pathname)) continue;
    const path = u.pathname;
    let floorPlan: boolean;
    if (u.hostname.endsWith('rightmove.co.uk')) {
      // Rightmove pages also show the agent's logo and other houses: keep this listing's photos and plans only.
      if (!/\/property-(photo|floorplan)\//.test(path) || (id && !path.includes(`/${id}/`))) continue;
      floorPlan = path.includes('/property-floorplan/');
    } else if (u.hostname.endsWith('onthemarket.com')) {
      if (!/\/properties\/\d+\//.test(path) || (id && !path.includes(`/properties/${id}/`))) continue;
      floorPlan = /\/floor-plan-/.test(path);
    } else {
      if (!u.hostname.startsWith('lid.') || !path.startsWith('/u/')) continue;
      floorPlan = planFiles.has(path.split('/').pop() ?? '');
    }
    if (!out.some((p) => p.url === u.href)) out.push({ url: u.href, floorPlan });
  }
  // Zoopla keeps the floor plan out of the photo gallery, by file name only.
  for (const file of planFiles) {
    if (!out.some((p) => p.url.endsWith(`/${file}`))) out.push({ url: `https://lid.zoocdn.com/u/2400/1800/${file}`, floorPlan: true });
  }
  return [...out.filter((p) => !p.floorPlan), ...out.filter((p) => p.floorPlan)].slice(0, MAX_PHOTOS);
}

/** Reads what the button put in the page address ("#import=..."). Null when there is nothing there or it is not well formed. */
export function readSentListing(hash: string): SentListing | null {
  if (!hash.startsWith('#import=')) return null;
  let data: Partial<Payload>;
  try {
    data = JSON.parse(decodeURIComponent(hash.slice('#import='.length))) as Partial<Payload>;
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object' || typeof data.x !== 'string' || !data.x.trim()) return null;
  let url = '';
  let site: SentListing['site'] = null;
  try {
    const u = new URL(String(data.u ?? ''));
    site = u.protocol === 'https:' ? (SITES.find(([host]) => host.test(u.hostname))?.[1] ?? null) : null;
    if (site) url = u.href;
  } catch {
    /* no usable address: the text is still read */
  }
  const postcode = /^[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}$/i.exec(String(data.p ?? '').trim())?.[0].toUpperCase() ?? null;
  const strings = (list: unknown) => (Array.isArray(list) ? list.filter((s): s is string => typeof s === 'string').slice(0, 200) : []);
  return { url, site, text: data.x.slice(0, 20000), postcode, photos: listingPhotos(strings(data.i), strings(data.f), url) };
}
