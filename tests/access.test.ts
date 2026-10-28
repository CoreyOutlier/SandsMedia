import test from "node:test";
import assert from "node:assert/strict";
import { canSignIn, isAllowedEmail, safeRedirect } from "../src/lib/access.ts";
import { clearance } from "../src/lib/clearance.ts";

test("verified Google identity and an exact allowlist match are both required", () => {
  const list = "staff@example.test, AGENCY@example.test";
  assert.equal(canSignIn("google", { email: "agency@example.test", email_verified: true }, list), true);
  for (const profile of [{ email: "staff@example.test", email_verified: false }, { email: "staff@example.test" }, { email: "staff@example.test.attacker.test", email_verified: true }, { email: "other@example.test", email_verified: true }, null]) {
    assert.equal(canSignIn("google", profile, list), false);
  }
  assert.equal(canSignIn("other", { email: "staff@example.test", email_verified: true }, list), false);
  assert.equal(canSignIn("google", { email: "staff@example.test", email_verified: true }, ""), false);
});
test("removing an email rejects an existing identity on subsequent access", () => {
  assert.equal(isAllowedEmail("staff@example.test", "staff@example.test"), true);
  assert.equal(isAllowedEmail("staff@example.test", "agency@example.test"), false);
  assert.equal(isAllowedEmail(undefined, "staff@example.test"), false);
});
test("callback redirects cannot leave the configured origin", () => {
  const origin = "https://portal.example.test";
  for (const target of ["https://attacker.test", "//attacker.test", "javascript:alert(1)", "https://portal.example.test@attacker.test"]) assert.equal(safeRedirect(target, origin), origin + "/patients");
  assert.equal(safeRedirect("/other-uploads", origin), origin + "/other-uploads");
});
test("an incomplete or unconsented session prevents patient clearance", () => {
  const complete = { finishedAt: "2026-10-28", consentEvents: [{ consented: true }] };
  assert.equal(clearance({ consentWithdrawnAt: null, sessions: [complete] }).status, "cleared");
  assert.equal(clearance({ consentWithdrawnAt: null, sessions: [] }).status, "hold");
  for (const session of [{ finishedAt: null, consentEvents: [{ consented: true }] }, { finishedAt: "2026-10-28", consentEvents: [] }]) assert.deepEqual(clearance({ consentWithdrawnAt: null, sessions: [complete, session] }), { status: "hold", missing: 1 });
  assert.equal(clearance({ consentWithdrawnAt: "2026-10-28", sessions: [complete] }).status, "withdrawn");
});
