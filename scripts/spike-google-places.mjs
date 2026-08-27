import assert from "node:assert/strict";

const endpoint = "https://places.googleapis.com/v1/places:searchNearby";
const fieldMask = [
  "places.id",
  "places.displayName",
  "places.primaryType",
  "places.types",
  "places.formattedAddress",
  "places.location",
  "places.businessStatus",
  "places.currentOpeningHours",
  "places.rating",
  "places.userRatingCount",
  "places.priceLevel",
  "places.photos",
].join(",");

const types = [
  "cafe", "bakery", "restaurant", "book_store", "library", "museum",
  "art_gallery", "cultural_center", "park", "movie_theater",
  "bowling_alley", "amusement_center", "shopping_mall", "aquarium", "zoo",
  "tourist_attraction",
];

function numberOption(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  const value = index === -1 ? fallback : Number(process.argv[index + 1]);
  if (!Number.isFinite(value)) throw new Error(`--${name} must be a number`);
  return value;
}

function coverage(places) {
  const present = (value) => value !== undefined && value !== null;
  return {
    places: places.length,
    address: places.filter((place) => present(place.formattedAddress)).length,
    openingHours: places.filter((place) => present(place.currentOpeningHours)).length,
    rating: places.filter((place) => present(place.rating)).length,
    reviewCount: places.filter((place) => present(place.userRatingCount)).length,
    photo: places.filter((place) => place.photos?.length).length,
    price: places.filter((place) => present(place.priceLevel)).length,
  };
}

function selfTest() {
  assert.equal(fieldMask.includes("*"), false);
  assert.equal(new Set(types).size, types.length);
  assert.deepEqual(coverage([{ formattedAddress: "x", rating: 0, photos: [] }]), {
    places: 1,
    address: 1,
    openingHours: 0,
    rating: 1,
    reviewCount: 0,
    photo: 0,
    price: 0,
  });
  console.log("google places spike self-test: ok");
}

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) throw new Error("Set GOOGLE_MAPS_API_KEY in the server environment");

  // ponytail: one billable request is enough for the spike; add pagination only
  // if a measured production pool cannot reach three valid candidates.
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": apiKey,
      "x-goog-fieldmask": fieldMask,
    },
    body: JSON.stringify({
      includedTypes: types,
      maxResultCount: 20,
      rankPreference: "POPULARITY",
      locationRestriction: {
        circle: {
          center: {
            latitude: numberOption("lat", 10.7769),
            longitude: numberOption("lon", 106.7009),
          },
          radius: numberOption("radius", 5000),
        },
      },
      languageCode: "vi",
      regionCode: "VN",
    }),
  });

  const result = await response.json();
  if (!response.ok) throw new Error(`Google Places returned ${response.status}: ${result.error?.message ?? "unknown error"}`);
  console.log(JSON.stringify({ coverage: coverage(result.places ?? []), places: result.places ?? [] }, null, 2));
}
