import assert from "node:assert/strict";

const defaults = { lat: 10.7769, lon: 106.7009, radius: 5000, limit: 30 };

function options(args) {
  const parsed = { ...defaults };
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.replace(/^--/, "");
    if (!(key in parsed) || args[i + 1] === undefined) throw new Error(`Invalid option: ${args[i]}`);
    parsed[key] = Number(args[i + 1]);
  }
  if (![parsed.lat, parsed.lon, parsed.radius, parsed.limit].every(Number.isFinite)) throw new Error("Options must be numbers");
  return parsed;
}

function distanceKm(a, b) {
  const radians = (degrees) => (degrees * Math.PI) / 180;
  const dLat = radians(b.lat - a.lat);
  const dLon = radians(b.lon - a.lon);
  const value = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function placeType(tags) {
  return tags.amenity ?? tags.shop ?? tags.tourism ?? tags.leisure ?? "unknown";
}

function address(tags) {
  return tags["addr:full"] ?? [tags["addr:housenumber"], tags["addr:street"], tags["addr:district"], tags["addr:city"]]
    .filter(Boolean)
    .join(", ");
}

function normalize(element, origin) {
  const [lon, lat] = element.geometry.coordinates;
  const tags = element.properties;
  return {
    id: `${tags.osm_type}/${tags.osm_id}`,
    name: tags.name,
    type: tags.osm_value ?? tags.type ?? placeType(tags),
    address: [tags.housenumber, tags.street, tags.district, tags.city].filter(Boolean).join(", ") || null,
    distanceKm: Number(distanceKm(origin, { lat, lon }).toFixed(2)),
    openingHours: null,
    rating: null,
    reviewCount: null,
    photo: null,
    price: null,
  };
}

function viewbox({ lat, lon, radius }) {
  const latDelta = radius / 111_320;
  const lonDelta = radius / (111_320 * Math.cos((lat * Math.PI) / 180));
  return [lon - lonDelta, lat - latDelta, lon + lonDelta, lat + latDelta].join(",");
}

function summarize(places) {
  const fields = ["address", "openingHours", "rating", "reviewCount", "photo", "price"];
  return Object.fromEntries(fields.map((field) => [field, places.filter((place) => place[field] !== null).length]));
}

function selfTest() {
  assert.equal(Math.round(distanceKm({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })), 111);
  assert.equal(address({ "addr:housenumber": "1", "addr:street": "Main" }), "1, Main");
  assert.deepEqual(summarize([{ address: "x", openingHours: null, rating: null, reviewCount: null, photo: null, price: null }]).address, 1);
  console.log("spike self-test: ok");
}

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  const config = options(process.argv.slice(2));
  const endpoint = process.env.PHOTON_URL ?? "https://photon.komoot.io/api/";
  const terms = ["cafe", "restaurant", "bakery", "bookstore", "library", "museum", "gallery", "park", "cinema", "shopping mall"];
  const data = [];
  for (const term of terms) {
    const url = new URL(endpoint);
    url.search = new URLSearchParams({
      q: term,
      lat: String(config.lat),
      lon: String(config.lon),
      bbox: viewbox(config),
      limit: "10",
    });
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Photon returned ${response.status}: ${await response.text()}`);
    data.push(...(await response.json()).features);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  const seen = new Set();
  const places = data
    .filter((element) => ["amenity", "shop", "tourism", "leisure"].includes(element.properties.osm_key))
    .map((element) => normalize(element, config))
    .filter((place) => place.name)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .filter((place) => {
      const key = place.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, config.limit);

  if (places.length < config.limit) throw new Error(`Only ${places.length}/${config.limit} places found`);
  console.log(JSON.stringify({ provider: "OpenStreetMap/Photon", config, coverage: summarize(places), places }, null, 2));
}
