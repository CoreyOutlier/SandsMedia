import test from "node:test";
import assert from "node:assert/strict";
import { activeLink } from "../src/lib/portal/security.ts";
import { canCompleteRenewal } from "../src/lib/portal/lifecycle-policy.ts";
import { deleteLibraryMedia, deleteLibraryPatient, PortalRequestError } from "../src/components/portal/types.ts";

test("a deletion invalidates an otherwise active share and an in-flight consent renewal", () => {
  const now = Date.UTC(2026, 10, 4);
  const activePatient = { consentWithdrawnAt: null, archivedAt: null, deletedAt: null };
  const link = { expiresAt: new Date(now + 60000), revokedAt: null, patient: activePatient };
  assert.equal(activeLink(link, now), true);
  assert.equal(activeLink({ ...link, patient: { ...activePatient, deletedAt: new Date(now) } }, now), false);
  const renewing = { archivedAt: null, consentWithdrawnAt: new Date(now - 1000), lifecycleVersion: 7, deletedAt: null };
  assert.equal(canCompleteRenewal(renewing, 7), true);
  assert.equal(canCompleteRenewal({ ...renewing, deletedAt: new Date(now) }, 7), false);
});

test("a lost deletion response retries the same confirmed target only once", async () => {
  const original = globalThis.fetch;
  try {
    for (const general of [false, true]) {
      const calls: { path: string; body: unknown }[] = [];
      globalThis.fetch = async (path, init) => {
        calls.push({ path: String(path), body: JSON.parse(String(init?.body)) });
        if (calls.length === 1) throw new Error("Connection interrupted");
        return Response.json({ deleted: true });
      };
      await deleteLibraryMedia("synthetic-media", general);
      assert.equal(calls.length, 2);
      assert.deepEqual(calls[0], calls[1]);
      assert.deepEqual(calls[0], { path: "/api/media/synthetic-media/delete", body: { general, confirmed: true } });
    }
  } finally { globalThis.fetch = original; }
});

test("a known removal remains visible to the caller when its cleanup retry loses the response", async () => {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) return Response.json({ error: "DELETION_PENDING" }, { status: 503 });
    throw new Error("Connection interrupted");
  };
  try {
    await assert.rejects(() => deleteLibraryPatient("synthetic-patient"), error => {
      assert.ok(error instanceof PortalRequestError);
      assert.equal(error.code, "DELETION_PENDING");
      assert.match(error.message, /Removed from the portal/);
      return true;
    });
    assert.equal(calls, 2);
  } finally { globalThis.fetch = original; }
});

test("a cleanup retry can finish deletion without surfacing an obsolete pending error", async () => {
  const original = globalThis.fetch; const calls: { path: string; body: unknown }[] = [];
  globalThis.fetch = async (path, init) => {
    calls.push({ path: String(path), body: JSON.parse(String(init?.body)) });
    return calls.length === 1
      ? Response.json({ error: "DELETION_PENDING" }, { status: 503 })
      : Response.json({ deleted: true });
  };
  try {
    await deleteLibraryPatient("synthetic-patient");
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0], calls[1]);
    assert.deepEqual(calls[0].body, { confirmed: true });
  } finally { globalThis.fetch = original; }
});

test("deletion never retries authorization or validation failures and never loops on unavailable storage", async () => {
  const original = globalThis.fetch;
  try {
    for (const [status, code, expectedCalls] of [[401, "SIGN_IN_REQUIRED", 1], [400, "INVALID_FIELDS", 1], [503, "DELETION_PENDING", 2]] as const) {
      let calls = 0;
      globalThis.fetch = async () => { calls++; return Response.json({ error: code }, { status }); };
      await assert.rejects(() => deleteLibraryPatient("synthetic-patient"), error => {
        assert.ok(error instanceof PortalRequestError);
        assert.equal(error.code, code);
        return true;
      });
      assert.equal(calls, expectedCalls);
    }
  } finally { globalThis.fetch = original; }
});
