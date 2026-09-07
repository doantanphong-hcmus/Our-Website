import { describe, expect, it, vi } from "vitest";
import { createCuratedPlaces, createGeoapifyPlaces, filterPlaceCandidates, normalizeCuratedPlace, normalizeGeoapifyPlace, PlacesProviderError, type CuratedPlace } from "../../apps/worker/src/places";

const feature = {
  type: "Feature",
  geometry: { type: "Point", coordinates: [106.701, 10.777] },
  properties: {
    place_id: "place-12345678",
    name: "Quán nhỏ",
    formatted: "1 Nguyễn Huệ, TP.HCM",
    categories: ["catering.restaurant", "catering"],
  },
};

const curated: CuratedPlace = {
  id: "museum-1",
  name: "Bảo tàng thú vị",
  type: "museum",
  categories: ["tourism.museum", "entertainment"],
  address: "1 Đường Mới, TP.HCM",
  latitude: 10.777,
  longitude: 106.701,
  openingHours: "Tu-Su 09:00-18:00",
  rating: 4.7,
  reviewCount: 321,
  reviewSummary: "Không gian khác lạ, nhiều góc đáng khám phá và được khách ghé thăm đánh giá tích cực.",
  budgetTier: "under_200k",
  photoUrl: "/places/museum-1.webp",
  website: "https://example.com/museum",
  sourceUrl: "https://maps.example.com/museum-1",
  verifiedAt: "2026-09-07",
  approved: true,
};

function memoryCache() {
  const values = new Map<string, Response>();
  return {
    match: vi.fn(async (request: Request) => values.get(request.url)?.clone()),
    put: vi.fn(async (request: Request, response: Response) => { values.set(request.url, response.clone()); }),
  };
}

describe("Geoapify Places adapter", () => {
  it("normalizes only the provider-neutral nullable contract", () => {
    const place = normalizeGeoapifyPlace(feature, { latitude: 10.7769, longitude: 106.7009 });
    expect(place).toMatchObject({
      provider: "geoapify", providerId: "place-12345678", name: "Quán nhỏ",
      type: "catering", address: "1 Nguyễn Huệ, TP.HCM", openingHours: null,
      rating: null, reviewCount: null, photoUrl: null,
    });
    expect(place?.distanceKm).toBe(0.02);
    expect(place).not.toHaveProperty("price");
  });

  it("searches with a 20-place cap and reuses a secret-free cache key", async () => {
    const cache = memoryCache();
    const reserveRequest = vi.fn(async () => {});
    const fetcher = vi.fn(async () => Response.json({ type: "FeatureCollection", features: [feature] }));
    const places = createGeoapifyPlaces({ apiKey: "secret-key", reserveRequest, cache, fetcher });
    const input = { latitude: 10.7769, longitude: 106.7009, radiusMeters: 5_000, categories: ["catering.restaurant"] };

    expect((await places.search(input))[0].name).toBe("Quán nhỏ");
    expect((await places.search(input))[0].name).toBe("Quán nhỏ");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(reserveRequest).toHaveBeenCalledTimes(1);
    const providerUrl = new URL(String(fetcher.mock.calls[0][0]));
    expect(providerUrl.searchParams.get("limit")).toBe("20");
    expect(providerUrl.searchParams.get("apiKey")).toBe("secret-key");
    expect(cache.put.mock.calls[0][0].url).not.toContain("secret-key");
  });

  it("uses the details feature as its field mask and shares it with photo", async () => {
    const cache = memoryCache();
    const reserveRequest = vi.fn(async () => {});
    const details = {
      ...feature,
      geometry: { type: "Polygon", coordinates: [] },
      properties: {
        ...feature.properties, feature_type: "details", lat: 10.777, lon: 106.701,
        opening_hours: "Mo-Su 08:00-22:00", website: "https://example.com",
        wiki_and_media: { image: "https://images.example.com/place.jpg" },
      },
    };
    const fetcher = vi.fn(async () => Response.json({ type: "FeatureCollection", features: [details] }));
    const places = createGeoapifyPlaces({ apiKey: "secret-key", reserveRequest, cache, fetcher });

    expect((await places.detail("place-12345678"))?.openingHours).toBe("Mo-Su 08:00-22:00");
    expect(await places.photo("place-12345678")).toBe("https://images.example.com/place.jpg");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(new URL(String(fetcher.mock.calls[0][0])).searchParams.get("features")).toBe("details");
  });

  it("validates before quota and never retries provider failures", async () => {
    const reserveRequest = vi.fn(async () => {});
    const fetcher = vi.fn(async () => new Response(null, { status: 503 }));
    const places = createGeoapifyPlaces({ apiKey: "secret-key", reserveRequest, fetcher });
    await expect(places.search({ latitude: 91, longitude: 0, radiusMeters: 1_000, categories: ["catering"] })).rejects.toBeInstanceOf(RangeError);
    expect(reserveRequest).not.toHaveBeenCalled();
    await expect(places.detail("place-12345678")).rejects.toBeInstanceOf(PlacesProviderError);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("curated Places adapter", () => {
  it("only accepts approved places with sourced display facts", () => {
    expect(normalizeCuratedPlace(curated, { latitude: 10.7769, longitude: 106.7009 })).toMatchObject({
      provider: "curated",
      providerId: "museum-1",
      rating: 4.7,
      reviewCount: 321,
      photoUrl: "/places/museum-1.webp",
      sourceUrl: "https://maps.example.com/museum-1",
      verifiedAt: "2026-09-07",
      distanceKm: 0.02,
    });
    expect(normalizeCuratedPlace({ ...curated, approved: false } as unknown as CuratedPlace)).toBeNull();
    expect(normalizeCuratedPlace({ ...curated, photoUrl: "" })).toBeNull();
    expect(normalizeCuratedPlace({ ...curated, rating: 6 })).toBeNull();
    expect(normalizeCuratedPlace({ ...curated, sourceUrl: "http://example.com" })).toBeNull();
    expect(normalizeCuratedPlace({ ...curated, budgetTier: "unknown" } as unknown as CuratedPlace)).toBeNull();
  });

  it("searches locally by category and distance, with detail and photo", async () => {
    const places = createCuratedPlaces([
      curated,
      { ...curated, id: "far-away", latitude: 11.5, photoUrl: "https://images.example.com/far.webp" },
    ]);
    const results = await places.search({
      latitude: 10.7769,
      longitude: 106.7009,
      radiusMeters: 5_000,
      categories: ["tourism.museum"],
    });
    expect(results.map((place) => place.providerId)).toEqual(["museum-1"]);
    expect((await places.detail("museum-1"))?.reviewSummary).toBe(curated.reviewSummary);
    expect(await places.photo("museum-1")).toBe("/places/museum-1.webp");
  });

  it("filters only complete, unique candidates by distance and budget", () => {
    const base = normalizeCuratedPlace(curated)!;
    const nearby = { ...base, providerId: "nearby", distanceKm: 2, budgetTier: "free_low" as const };
    const matching = { ...base, distanceKm: 4 };
    const expensive = { ...base, providerId: "expensive", distanceKm: 4, budgetTier: "two_to_five_hundred_k" as const };
    const incomplete = { ...base, providerId: "incomplete", distanceKm: 4, photoUrl: null };
    expect(filterPlaceCandidates([nearby, matching, matching, expensive, incomplete], {
      distance: "three_to_five",
      budget: "under_200k",
    }).map((place) => place.providerId)).toEqual(["museum-1"]);
    expect(filterPlaceCandidates([nearby, matching], { distance: "custom", customDistanceKm: 4, budget: "any" }))
      .toHaveLength(2);
    expect(() => filterPlaceCandidates([matching], { distance: "custom", customDistanceKm: 101, budget: "any" }))
      .toThrow(RangeError);
  });
});
