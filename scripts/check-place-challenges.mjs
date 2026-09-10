import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const content = JSON.parse(await readFile(new URL("../content/place-challenges.v1.json", import.meta.url), "utf8"));
const places = JSON.parse(await readFile(new URL("../content/places.v1.json", import.meta.url), "utf8"));
const unique = (values, label) => assert.equal(new Set(values).size, values.length, `${label} must be unique`);

function validate(value) {
  assert.equal(value.version, 1);
  assert.equal(value.language, "vi");
  assert.ok(["pending_owner_review", "approved"].includes(value.approval?.status));
  if (value.approval.status === "approved") {
    assert.match(value.approval.reviewedBy ?? "", /\S/);
    assert.match(value.approval.reviewedAt ?? "", /^\d{4}-\d{2}-\d{2}$/);
  }
  const placeTypes = [...new Set(places.places.map((place) => place.type))].sort();
  if (value.approval.status === "approved") assert.deepEqual([...value.placeTypes].sort(), placeTypes);
  unique(value.placeTypes, "place types");
  unique(value.safetyTags.map(({ id }) => id), "safety tag ids");
  const allowedTypes = new Set(value.placeTypes);
  const allowedSafety = new Set(value.safetyTags.map(({ id }) => id));
  const coverage = Object.fromEntries(value.placeTypes.map((type) => [type, 0]));

  assert.ok(Array.isArray(value.challenges));
  unique(value.challenges.map(({ id }) => id), "challenge ids");
  unique(value.challenges.map(({ text }) => text.toLocaleLowerCase("vi")), "challenge texts");
  for (const challenge of value.challenges) {
    assert.match(challenge.id, /^[a-z][a-z0-9-]*$/);
    assert.ok(allowedTypes.has(challenge.placeType), `${challenge.id} has unknown place type`);
    assert.ok(typeof challenge.text === "string" && challenge.text.trim().length >= 15 && challenge.text.length <= 180);
    assert.ok(Number.isInteger(challenge.estimatedMinutes) && challenge.estimatedMinutes >= 2 && challenge.estimatedMinutes <= 30);
    assert.ok(Number.isInteger(challenge.maxExtraCostVnd) && challenge.maxExtraCostVnd >= 0 && challenge.maxExtraCostVnd <= 100_000);
    assert.ok(Array.isArray(challenge.safetyTags) && challenge.safetyTags.length > 0);
    unique(challenge.safetyTags, `${challenge.id} safety tags`);
    for (const tag of challenge.safetyTags) assert.ok(allowedSafety.has(tag), `${challenge.id} has unknown safety tag`);
    assert.ok(challenge.safetyTags.includes("venue_rules"), `${challenge.id} must respect venue rules`);
    coverage[challenge.placeType]++;
  }
  for (const [type, count] of Object.entries(coverage)) assert.ok(count >= 10, `${type} needs at least 10 challenges`);
  return value;
}

validate(content);
assert.throws(() => validate({ ...content, challenges: [{ ...content.challenges[0], placeType: "unknown" }, ...content.challenges.slice(1)] }));
assert.throws(() => validate({ ...content, challenges: [{ ...content.challenges[0], safetyTags: [] }, ...content.challenges.slice(1)] }));
if (process.env.REQUIRE_APPROVED_CONTENT === "1") assert.equal(content.approval.status, "approved", "place challenges need owner approval");
console.log(`P2.9 place challenges: ${content.challenges.length} challenges, ${content.placeTypes.length} place types (${content.approval.status}) = OK`);
