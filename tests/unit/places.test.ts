import { describe, expect, it, vi } from "vitest";
import { createGeoapifyPlaces, normalizeGeoapifyPlace, PlacesProviderError } from "../../apps/worker/src/places";

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
