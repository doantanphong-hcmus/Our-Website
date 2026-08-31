import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const file = path.resolve(import.meta.dirname, "../content/food.v1.json");
const content = JSON.parse(await readFile(file, "utf8"));

function unique(values, label) {
  assert.equal(new Set(values).size, values.length, `${label} must be unique`);
}

function validate(value) {
  assert.equal(value.version, 1);
  assert.equal(value.allergenPolicy, "possible_presence_conservative");
  assert.ok(typeof value.allergenNotice === "string" && value.allergenNotice.length >= 40);
  assert.ok(["pending_owner_review", "approved"].includes(value.approval?.status));
  if (value.approval.status === "approved") {
    assert.match(value.approval.reviewedBy ?? "", /\S/);
    assert.match(value.approval.reviewedAt ?? "", /^\d{4}-\d{2}-\d{2}$/);
  }

  for (const taxonomy of ["categories", "allergens", "exclusions"]) {
    assert.ok(Array.isArray(value[taxonomy]) && value[taxonomy].length > 0);
    unique(value[taxonomy].map((item) => item.id), `${taxonomy} ids`);
    unique(value[taxonomy].map((item) => item.label.toLocaleLowerCase("vi")), `${taxonomy} labels`);
    for (const item of value[taxonomy]) {
      assert.match(item.id, /^[a-z][a-z0-9_]*$/);
      assert.match(item.label, /\S/);
    }
  }

  assert.ok(Array.isArray(value.dishes) && value.dishes.length >= 40, "at least 40 curated dishes required");
  unique(value.dishes.map((dish) => dish.id), "dish ids");
  unique(value.dishes.map((dish) => dish.name.toLocaleLowerCase("vi")), "dish names");
  const allowed = {
    categories: new Set(value.categories.map((item) => item.id)),
    possibleAllergens: new Set(value.allergens.map((item) => item.id)),
    exclusionTags: new Set(value.exclusions.map((item) => item.id)),
  };
  const coverage = Object.fromEntries(value.categories.map((item) => [item.id, 0]));
  for (const dish of value.dishes) {
    assert.match(dish.id, /^[a-z][a-z0-9-]*$/);
    assert.ok(typeof dish.name === "string" && dish.name.trim().length > 0 && dish.name.length <= 80);
    assert.ok(Array.isArray(dish.categories) && dish.categories.length > 0);
    for (const field of ["categories", "possibleAllergens", "exclusionTags"]) {
      assert.ok(Array.isArray(dish[field]), `${dish.id}.${field} must be an array`);
      unique(dish[field], `${dish.id}.${field}`);
      for (const tag of dish[field]) assert.ok(allowed[field].has(tag), `${dish.id} has unknown ${field}: ${tag}`);
    }
    for (const category of dish.categories) coverage[category]++;
  }
  for (const [category, count] of Object.entries(coverage)) assert.ok(count >= 4, `${category} needs at least 4 dishes`);
  return value;
}

validate(content);
assert.throws(() => validate({ ...content, dishes: [{ ...content.dishes[0], categories: ["unknown"] }, ...content.dishes.slice(1)] }));
if (process.env.REQUIRE_APPROVED_CONTENT === "1") assert.equal(content.approval.status, "approved", "food content needs owner approval");
console.log(`P3.1 food content: ${content.dishes.length} dishes, ${content.categories.length} categories, allergens/exclusions valid (${content.approval.status}) = OK`);
