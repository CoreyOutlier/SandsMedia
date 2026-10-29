import test from "node:test";
import assert from "node:assert/strict";
import { patientCollection, patientFlagUpdate } from "../src/lib/portal/patient-flags.ts";

test("patient collections validate exact names without coercing query inputs", () => {
  assert.equal(patientCollection(undefined, false), "all");
  for (const collection of ["all", "favorites", "celebrities"] as const) {
    assert.equal(patientCollection(collection, false), collection);
  }
  for (const value of [null, true, 1, "celebrity", " Favorites", ["favorites"], { toString: () => "favorites" }]) {
    assert.throws(() => patientCollection(value, false), { message: "INVALID_FIELDS" });
  }
});

test("patient collections cannot silently apply to general uploads", () => {
  assert.equal(patientCollection(undefined, true), "all");
  assert.equal(patientCollection("all", true), "all");
  for (const collection of ["favorites", "celebrities"]) {
    assert.throws(() => patientCollection(collection, true), { message: "INVALID_FIELDS" });
  }
});

test("marker changes require boolean assignments and cannot write another field", () => {
  for (const action of ["favorite", "celebrity"]) {
    for (const value of [undefined, null, "true", "false", 0, 1, {}, []]) {
      assert.throws(() => patientFlagUpdate(action, value), { message: "INVALID_FIELDS" });
    }
  }
  for (const action of [undefined, "isFavorite", "isCelebrity", "consentWithdrawnAt", "lifecycleVersion", "__proto__"]) {
    assert.throws(() => patientFlagUpdate(action, true), { message: "INVALID_FIELDS" });
  }
  const patient = { isFavorite: false, isCelebrity: true, lifecycleVersion: 4, consentWithdrawnAt: new Date(0) };
  const once = { ...patient, ...patientFlagUpdate("favorite", true) };
  const retried = { ...once, ...patientFlagUpdate("favorite", true) };
  assert.deepEqual(retried, { ...patient, isFavorite: true });
  assert.deepEqual({ ...retried, ...patientFlagUpdate("celebrity", false) }, { ...patient, isFavorite: true, isCelebrity: false });
  assert.deepEqual({ ...patient, ...patientFlagUpdate("favorite", false) }, patient);
});
