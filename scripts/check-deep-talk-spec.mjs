import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const spec = JSON.parse(await readFile(new URL("../content/deep-talk.v1.json", import.meta.url), "utf8"));
const ids = (values) => values.map(({ id }) => id);
const unique = (values, label) => assert.equal(new Set(values).size, values.length, `${label} must be unique`);

assert.equal(spec.version, 1);
assert.equal(spec.language, "vi");
assert.deepEqual(spec.deck, {
  cardCount: 20, cardsPerGroup: 4, minimumDistinctForms: 5,
  maxConsecutiveSameForm: 3, positiveEndingCards: 2,
});
assert.deepEqual(spec.questionLength, { unit: "characters", min: 15, max: 180 });
assert.deepEqual(spec.safetyDefaults, {
  sensitiveTopicsRequireMutualConsent: true,
  userAnswersAllowedInPrompt: false,
  unopenedCardsAllowedInClientPayload: false,
});

const groupIds = ids(spec.groups);
const formIds = ids(spec.forms);
const severityIds = ids(spec.severities);
const sensitiveIds = ids(spec.sensitiveTopics);
for (const [label, values] of Object.entries({ groups: groupIds, forms: formIds, severities: severityIds,
  safeTopics: ids(spec.safeTopics), sensitiveTopics: sensitiveIds, forbiddenPatterns: ids(spec.forbiddenPatterns) })) unique(values, label);
assert.deepEqual(groupIds, ["mo_long", "ky_uc", "thau_hieu", "chan_that", "tuong_lai"]);
assert.equal(spec.deck.cardCount, spec.groups.length * spec.deck.cardsPerGroup);
assert.equal(formIds.length, 10);
assert.deepEqual(spec.severities.map(({ id, rank }) => [id, rank]), [["light", 1], ["medium", 2], ["heavy", 3]]);
assert.equal(sensitiveIds.length, 8);
assert.deepEqual(spec.groups[0].allowedSeverities, ["light"]);
assert.equal(spec.groups[0].allowsSensitiveTopics, false);
assert.ok(spec.groups.find(({ id }) => id === "chan_that").allowedSeverities.includes("heavy"));
for (const group of spec.groups) assert.ok(group.allowedSeverities.every((id) => severityIds.includes(id)));
for (const rule of spec.forbiddenPatterns) {
  assert.equal(rule.action, "block");
  assert.ok(rule.patterns.length > 0);
  for (const pattern of rule.patterns) assert.doesNotThrow(() => new RegExp(pattern, "iu"));
}

const schema = spec.cardSchema;
assert.equal(schema.type, "object");
assert.equal(schema.additionalProperties, false);
assert.deepEqual([...schema.required].sort(), ["form", "group", "positive", "question", "sensitivityTopics", "severity"]);
assert.deepEqual(schema.properties.group.enum, groupIds);
assert.deepEqual(schema.properties.form.enum, formIds);
assert.deepEqual(schema.properties.sensitivityTopics.items.enum, sensitiveIds);
assert.deepEqual(schema.properties.severity.enum, severityIds);
assert.equal(schema.properties.question.minLength, spec.questionLength.min);
assert.equal(schema.properties.question.maxLength, spec.questionLength.max);

console.log(`P4.1 Deep Talk spec: ${spec.deck.cardCount} cards, ${groupIds.length} groups, ${formIds.length} forms, ${sensitiveIds.length} sensitive topics = OK`);
