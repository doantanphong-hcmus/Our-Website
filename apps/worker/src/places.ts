export type Place = {
  provider: "geoapify";
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
  photoUrl: string | null;
  website: string | null;
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
    photoUrl: httpsUrl(media.image),
    website: httpsUrl(properties.website),
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
    if (!Number.isFinite(input.latitude) || input.latitude < -90 || input.latitude > 90
      || !Number.isFinite(input.longitude) || input.longitude < -180 || input.longitude > 180
      || !Number.isInteger(input.radiusMeters) || input.radiusMeters < 100 || input.radiusMeters > 50_000
      || !Number.isInteger(limit) || limit < 1 || limit > 20
      || !input.categories.length || input.categories.some((category) => !/^[a-z0-9_.]+$/.test(category))) {
      throw new RangeError("Invalid Places search.");
    }
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
