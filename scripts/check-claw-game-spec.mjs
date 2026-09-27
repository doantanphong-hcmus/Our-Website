import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const spec = JSON.parse(await readFile(new URL("../content/claw-game.v1.json", import.meta.url), "utf8"));
const unique = (values, label) => assert.equal(new Set(values).size, values.length, `${label} must be unique`);

assert.equal(spec.version, 1);
assert.equal(spec.language, "vi");
assert.ok(["pending_owner_review", "approved"].includes(spec.approval.status));
assert.deepEqual(spec.economy, {
  currencyId: "star", packCost: 20, attemptsPerPack: 5, maximumPacksPerVietnamDay: 3,
  purchaseRole: "girlfriend", playRole: "girlfriend", minimumBalance: 0, realMoneyPurchases: false,
});
assert.equal(spec.skillPolicy.captureDeterminedBy, "physics_and_player_input");
assert.equal(spec.skillPolicy.randomVictoryRoll, false);
assert.equal(spec.skillPolicy.rewardRolledOnlyAfterCapture, true);

const stateIds = spec.attempt.states;
unique(stateIds, "attempt states");
unique(spec.attempt.transitions.map(({ from, to, action }) => `${from}:${to}:${action}`), "attempt transitions");
assert.ok(stateIds.includes(spec.attempt.initialState));
assert.ok(spec.attempt.terminalStates.every((state) => stateIds.includes(state)));
for (const transition of spec.attempt.transitions) {
  assert.ok(stateIds.includes(transition.from));
  assert.ok(stateIds.includes(transition.to));
  assert.ok(!spec.attempt.terminalStates.includes(transition.from), `${transition.from} must stay terminal`);
}
assert.equal(spec.attempt.playerCanRepositionAfterDrop, false);
assert.ok(spec.attempt.maximumPlayingSeconds < spec.attempt.abandonAfterSeconds);

assert.deepEqual(spec.physicsContract, {
  dimension: "2d", stepMode: "fixed", targetStepsPerSecond: 60, captureZone: "prize_chute",
  requiredEffects: ["gravity", "collision", "mass", "friction", "angular_momentum", "grip_force"],
  resultMustNotDependOnReducedMotion: true,
});

const outcomes = spec.rewardTable.outcomes;
unique(outcomes.map(({ id }) => id), "reward ids");
assert.equal(spec.rewardTable.guaranteedPerCapturedPlush, true);
assert.equal(spec.rewardTable.selectionSide, "server");
assert.equal(outcomes.reduce((sum, { weight }) => sum + weight, 0), 10_000);
assert.ok(outcomes.every(({ weight, stars }) => Number.isInteger(weight) && weight > 0 && Number.isInteger(stars) && stars > 0));
const expectedPerCapture = outcomes.reduce((sum, { weight, stars }) => sum + weight * stars, 0) / 10_000;
const expectedPerfectPack = expectedPerCapture * spec.economy.attemptsPerPack;
assert.ok(expectedPerfectPack < spec.economy.packCost, "a perfect pack must still consume stars on average");

unique(spec.starterPlushes.map(({ id }) => id), "plush ids");
assert.ok(spec.starterPlushes.length >= 6);
assert.ok(spec.starterPlushes.every(({ id, label, massClass, gripDifficulty }) =>
  /^[a-z][a-z0-9-]*$/.test(id) && label.trim().length > 0
  && ["light", "medium", "heavy"].includes(massClass)
  && ["easy", "medium", "hard"].includes(gripDifficulty)));

console.log(`E2.1 claw rules: ${spec.economy.packCost} stars/${spec.economy.attemptsPerPack} attempts, ${outcomes.length} guaranteed reward tiers, ${expectedPerfectPack.toFixed(2)} expected stars per perfect pack (${spec.approval.status}) = OK`);
