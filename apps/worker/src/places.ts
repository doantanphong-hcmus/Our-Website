export type Place = {
  provider: "geoapify" | "curated";
  providerId: string;
  name: string | null;
  type: string | null;
  categories: string[];
  address: string | null;
  latitude: number;
  longitude: number;
  distanceKm: number | null;
  openingHours: string | null;
  rating: number | null;
  reviewCount: number | null;
  reviewSummary: string | null;
  budgetTier: PlaceBudget | null;
  photoUrl: string | null;
  website: string | null;
  sourceUrl: string | null;
  verifiedAt: string | null;
};

export type PlaceBudget = "free_low" | "under_200k" | "two_to_five_hundred_k";
export type PlaceCandidateConditions = {
  distance: "under_3" | "three_to_five" | "five_to_ten" | "custom";
  customDistanceKm?: number;
  budget: PlaceBudget | "any";
};

export type CuratedPlace = {
  id: string;
  name: string;
  type: string;
  categories: string[];
  address: string;
  latitude: number;
  longitude: number;
  openingHours?: string | null;
  rating: number;
  reviewCount: number;
  reviewSummary: string;
  budgetTier: PlaceBudget;
  photoUrl: string;
  website?: string | null;
  sourceUrl: string;
  verifiedAt: string;
  approved: true;
};

export const PLACES_ATTRIBUTION = {
  provider: "Geoapify",
  providerUrl: "https://www.geoapify.com/",
  data: "OpenStreetMap contributors",
  dataUrl: "https://www.openstreetmap.org/copyright",
} as const;

type Feature = {
  geometry?: { type?: string; coordinates?: unknown[] };
  properties?: Record<string, unknown>;
};

type Search = {
  latitude: number;
  longitude: number;
  radiusMeters: number;
  categories: string[];
  limit?: number;
};

type AdapterOptions = {
  apiKey: string;
  reserveRequest: () => Promise<void>;
  cache?: Pick<Cache, "match" | "put">;
  fetcher?: typeof fetch;
};

export class PlacesProviderError extends Error {
  readonly code = "PLACE_PROVIDER_UNAVAILABLE";
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function httpsUrl(value: unknown): string | null {
  const candidate = text(value);
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function photoUrl(value: unknown): string | null {
  const candidate = text(value);
  return candidate?.startsWith("/") ? candidate : httpsUrl(candidate);
}

function verifiedDate(value: unknown): string | null {
  const candidate = text(value);
  if (!candidate || !/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return null;
  const date = new Date(`${candidate}T00:00:00Z`);
  return Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== candidate ? null : candidate;
}

function distanceKm(origin: { latitude: number; longitude: number }, place: { latitude: number; longitude: number }): number {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const latitude = radians(place.latitude - origin.latitude);
  const longitude = radians(place.longitude - origin.longitude);
  const a = Math.sin(latitude / 2) ** 2
    + Math.cos(radians(origin.latitude)) * Math.cos(radians(place.latitude)) * Math.sin(longitude / 2) ** 2;
  return Math.round(6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 100) / 100;
}

export function normalizeGeoapifyPlace(feature: Feature, origin?: { latitude: number; longitude: number }, fallbackId?: string): Place | null {
  const properties = feature.properties ?? {};
  const coordinates = feature.geometry?.type === "Point" ? feature.geometry.coordinates : undefined;
  const longitude = number(properties.lon) ?? number(coordinates?.[0]);
  const latitude = number(properties.lat) ?? number(coordinates?.[1]);
  const providerId = text(properties.place_id) ?? fallbackId ?? null;
  if (!providerId || latitude === null || longitude === null || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  const categories = Array.isArray(properties.categories)
    ? [...new Set(properties.categories.filter((value): value is string => typeof value === "string" && value.length > 0))].sort()
    : [];
  const media = properties.wiki_and_media && typeof properties.wiki_and_media === "object"
    ? properties.wiki_and_media as Record<string, unknown>
    : {};
  const place = { latitude, longitude };
  return {
    provider: "geoapify",
    providerId,
    name: text(properties.name),
    type: categories[0] ?? null,
    categories,
    address: text(properties.formatted),
    latitude,
    longitude,
    distanceKm: origin ? distanceKm(origin, place) : null,
    openingHours: text(properties.opening_hours),
    rating: number(properties.rating),
    reviewCount: number(properties.review_count) ?? number(properties.reviews_count),
    reviewSummary: null,
    budgetTier: null,
    photoUrl: httpsUrl(media.image),
    website: httpsUrl(properties.website),
    sourceUrl: null,
    verifiedAt: null,
  };
}

export function normalizeCuratedPlace(input: CuratedPlace, origin?: { latitude: number; longitude: number }): Place | null {
  const providerId = text(input.id);
  const name = text(input.name);
  const type = text(input.type);
  const address = text(input.address);
  const rating = number(input.rating);
  const reviewCount = number(input.reviewCount);
  const reviewSummary = text(input.reviewSummary);
  const image = photoUrl(input.photoUrl);
  const sourceUrl = httpsUrl(input.sourceUrl);
  const verifiedAt = verifiedDate(input.verifiedAt);
  const latitude = number(input.latitude);
  const longitude = number(input.longitude);
  const budgetTier = ["free_low", "under_200k", "two_to_five_hundred_k"].includes(input.budgetTier) ? input.budgetTier : null;
  if (input.approved !== true || !providerId || !name || !type || !address || !reviewSummary || !image || !sourceUrl || !verifiedAt
    || !budgetTier
    || latitude === null || latitude < -90 || latitude > 90 || longitude === null || longitude < -180 || longitude > 180
    || rating === null || rating < 0 || rating > 5 || reviewCount === null || !Number.isInteger(reviewCount) || reviewCount < 1) return null;
  const categories = Array.isArray(input.categories)
    ? [...new Set(input.categories.map(text).filter((value): value is string => value !== null))].sort()
    : [];
  if (!categories.length) return null;
  const place = { latitude, longitude };
  return {
    provider: "curated",
    providerId,
    name,
    type,
    categories,
    address,
    latitude,
    longitude,
    distanceKm: origin ? distanceKm(origin, place) : null,
    openingHours: text(input.openingHours),
    rating,
    reviewCount,
    reviewSummary,
    budgetTier,
    photoUrl: image,
    website: httpsUrl(input.website),
    sourceUrl,
    verifiedAt,
  };
}

export function filterPlaceCandidates(places: Place[], conditions: PlaceCandidateConditions): Place[] {
  const ranges = { under_3: [0, 3], three_to_five: [3, 5], five_to_ten: [5, 10] } as const;
  const maximum = conditions.distance === "custom" ? conditions.customDistanceKm : ranges[conditions.distance]?.[1];
  if (typeof maximum !== "number" || !Number.isFinite(maximum) || maximum < 1 || maximum > 100) {
    throw new RangeError("Invalid candidate distance.");
  }
  const minimum = conditions.distance === "custom" ? 0 : ranges[conditions.distance][0];
  const budgets: Record<PlaceCandidateConditions["budget"], PlaceBudget[]> = {
    free_low: ["free_low"],
    under_200k: ["free_low", "under_200k"],
    two_to_five_hundred_k: ["two_to_five_hundred_k"],
    any: ["free_low", "under_200k", "two_to_five_hundred_k"],
  };
  const allowedBudgets = budgets[conditions.budget];
  if (!allowedBudgets) throw new RangeError("Invalid candidate budget.");
  const seen = new Set<string>();
  return places.filter((place) => {
    const key = `${place.provider}:${place.providerId}`;
    const complete = place.provider === "curated" && place.name && place.address && place.photoUrl && place.sourceUrl
      && place.verifiedAt && place.reviewSummary && place.rating !== null && place.reviewCount !== null && place.reviewCount > 0
      && place.distanceKm !== null && place.budgetTier !== null;
    const outsideRange = place.distanceKm === null || (minimum > 0 && place.distanceKm <= minimum) || place.distanceKm > maximum;
    if (!complete || seen.has(key) || outsideRange || !allowedBudgets.includes(place.budgetTier!)) return false;
    seen.add(key);
    return true;
  });
}

export function createCuratedPlaces(catalog: CuratedPlace[]) {
  const places = catalog.map((place) => normalizeCuratedPlace(place)).filter((place): place is Place => place !== null);
  const byId = new Map(places.map((place) => [place.providerId, place]));
  return {
    async search(input: Search): Promise<Place[]> {
      const limit = input.limit ?? 20;
      validateSearch(input, limit);
      const wanted = new Set(input.categories);
      const origin = { latitude: input.latitude, longitude: input.longitude };
      return places
        .map((place) => ({ ...place, distanceKm: distanceKm(origin, place) }))
        .filter((place) => place.distanceKm! * 1_000 <= input.radiusMeters && place.categories.some((category) => wanted.has(category)))
        .sort((a, b) => a.distanceKm! - b.distanceKm!)
        .slice(0, limit);
    },
    async detail(providerId: string): Promise<Place | null> {
      if (!providerId.trim() || providerId.length > 500) throw new RangeError("Invalid place ID.");
      return byId.get(providerId) ?? null;
    },
    async photo(providerId: string): Promise<string | null> {
      return byId.get(providerId)?.photoUrl ?? null;
    },
  };
}

async function cached<T>(cache: AdapterOptions["cache"], key: string, seconds: number, load: () => Promise<T>): Promise<T> {
  const request = new Request(key);
  const hit = await cache?.match(request).catch(() => undefined);
  if (hit) return hit.json() as Promise<T>;
  const value = await load();
  await cache?.put(request, Response.json(value, { headers: { "Cache-Control": `max-age=${seconds}` } })).catch(() => {});
  return value;
}

function collection(value: unknown): Feature[] {
  if (!value || typeof value !== "object" || !Array.isArray((value as { features?: unknown }).features)) {
    throw new PlacesProviderError("Geoapify returned malformed data.");
  }
  return (value as { features: Feature[] }).features;
}

function validateSearch(input: Search, limit: number): void {
  if (!Number.isFinite(input.latitude) || input.latitude < -90 || input.latitude > 90
    || !Number.isFinite(input.longitude) || input.longitude < -180 || input.longitude > 180
    || !Number.isInteger(input.radiusMeters) || input.radiusMeters < 100 || input.radiusMeters > 50_000
    || !Number.isInteger(limit) || limit < 1 || limit > 20
    || !input.categories.length || input.categories.some((category) => !/^[a-z0-9_.]+$/.test(category))) {
    throw new RangeError("Invalid Places search.");
  }
}

export function createGeoapifyPlaces({ apiKey, reserveRequest, cache, fetcher = fetch }: AdapterOptions) {
  if (!apiKey.trim()) throw new Error("GEOAPIFY_API_KEY is missing.");

  async function request(path: string, parameters: URLSearchParams, cacheSeconds: number): Promise<Feature[]> {
    const cacheKey = `https://places-cache.invalid/${path}?${parameters}`;
    return cached(cache, cacheKey, cacheSeconds, async () => {
      await reserveRequest();
      parameters.set("apiKey", apiKey);
      let response: Response;
      try {
        response = await fetcher(`https://api.geoapify.com/v2/${path}?${parameters}`, { signal: AbortSignal.timeout(8_000) });
      } catch {
        throw new PlacesProviderError("Geoapify is unavailable.");
      }
      if (!response.ok) throw new PlacesProviderError(`Geoapify returned HTTP ${response.status}.`);
      return collection(await response.json().catch(() => null));
    });
  }

  async function search(input: Search): Promise<Place[]> {
    const limit = input.limit ?? 20;
    validateSearch(input, limit);
    const origin = { latitude: input.latitude, longitude: input.longitude };
    const location = `${input.longitude},${input.latitude}`;
    const parameters = new URLSearchParams({
      categories: [...new Set(input.categories)].sort().join(","),
      filter: `circle:${location},${input.radiusMeters}`,
      bias: `proximity:${location}`,
      limit: String(limit),
      lang: "vi",
    });
    return (await request("places", parameters, 15 * 60))
      .map((feature) => normalizeGeoapifyPlace(feature, origin))
      .filter((place): place is Place => place !== null);
  }

  async function detail(providerId: string): Promise<Place | null> {
    if (!providerId.trim() || providerId.length > 500) throw new RangeError("Invalid place ID.");
    const parameters = new URLSearchParams({ id: providerId, features: "details", lang: "vi" });
    const feature = (await request("place-details", parameters, 24 * 60 * 60))
      .find((item) => item.properties?.feature_type === "details");
    return feature ? normalizeGeoapifyPlace(feature, undefined, providerId) : null;
  }

  return {
    search,
    detail,
    async photo(providerId: string) {
      return (await detail(providerId))?.photoUrl ?? null;
    },
  };
}
