import assert from "node:assert/strict";

// Run against a local build or deployment without supplying any credentials.
const base = process.argv[2] ?? "http://127.0.0.1:3100";
for (const path of ["/patients", "/other-uploads", "/upload", "/admin"]) {
  const response = await fetch(base + path, { redirect: "manual" });
  assert.equal(response.status, 307);
  assert.equal(new URL(response.headers.get("location"), base).pathname, "/signin");
}
const response = await fetch(base + "/signin");
const html = await response.text();
assert.equal(response.status, 200);
assert.ok(html.includes("Other uploads"));
assert.ok(html.includes("Patients"));
assert.equal(response.headers.get("x-frame-options"), "DENY");
assert.ok(response.headers.get("cache-control").includes("no-store"));
const manifest = await (await fetch(base + "/manifest.webmanifest")).json();
assert.equal(manifest.display, "standalone");
assert.equal(manifest.icons.length, 2);
const session = await fetch(base + "/api/auth/session");
assert.ok([200, 503].includes(session.status));
if (session.status === 200) assert.equal(await session.json(), null);
console.info("HTTP smoke checks passed: both libraries require sign-in; sign-in, manifest, security headers, and anonymous session handling verified.");
