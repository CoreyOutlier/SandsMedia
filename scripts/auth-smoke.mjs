import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { encode } from "next-auth/jwt";

// Isolated local test process. No real Google credentials, database or patient data.
const origin = "http://127.0.0.1:3101";
const secret = randomBytes(32).toString("base64url");
const fixtures = await mkdtemp(join(tmpdir(), "posting-center-auth-"));
const discoveryStub = join(fixtures, "google-discovery.mjs");
// Exercise Auth.js's real sign-in route while keeping discovery deterministic.
// Never follow the resulting Google redirect or permit other external requests.
await writeFile(discoveryStub, `
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, options) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (url.href === "https://accounts.google.com/.well-known/openid-configuration") {
    return Response.json({ issuer: "https://accounts.google.com", authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth", code_challenge_methods_supported: ["S256"] });
  }
  if (url.origin === ${JSON.stringify(origin)}) return originalFetch(input, options);
  throw new Error("EXTERNAL_REQUEST_BLOCKED_IN_AUTH_TEST");
};
`);
const server = spawn(process.execPath, ["--import", pathToFileURL(discoveryStub).href, "node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "3101"], {
  env: { ...process.env, DATABASE_URL: "", AUTH_SECRET: secret, AUTH_GOOGLE_ID: "test-client", AUTH_GOOGLE_SECRET: "test-client-secret", AUTH_URL: origin, NEXTAUTH_URL: origin, APP_URL: origin, ALLOWED_EMAILS: "allowed@example.test" },
  stdio: "ignore",
});
try {
  let ready = false;
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(origin + "/signin")).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(ready, "Isolated test server must start");
  const csrfResponse = await fetch(origin + "/api/auth/csrf");
  assert.equal(csrfResponse.status, 200);
  const { csrfToken } = await csrfResponse.json();
  const csrfCookies = csrfResponse.headers.getSetCookie().map(cookie => cookie.split(";", 1)[0]).join("; ");
  const signInResponse = await fetch(origin + "/api/auth/signin/google", {
    method: "POST", redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded", cookie: csrfCookies },
    body: new URLSearchParams({ csrfToken, callbackUrl: origin + "/patients" }),
  });
  assert.equal(signInResponse.status, 302);
  const authorizationUrl = new URL(signInResponse.headers.get("location"));
  assert.equal(authorizationUrl.origin, "https://accounts.google.com");
  assert.equal(authorizationUrl.searchParams.get("prompt"), "select_account");
  assert.equal(authorizationUrl.searchParams.get("redirect_uri"), origin + "/api/auth/callback/google");
  assert.equal(authorizationUrl.searchParams.get("client_id"), "test-client");
  assert.equal(authorizationUrl.searchParams.get("code_challenge_method"), "S256");
  assert.ok(authorizationUrl.searchParams.get("code_challenge"));
  assert.deepEqual(new Set(authorizationUrl.searchParams.get("scope").split(" ")), new Set(["openid", "profile", "email"]));
  for (const route of ["/patients", "/other-uploads", "/upload", "/admin"]) {
    for (const identity of [
      { email: "allowed@example.test", verifiedGoogle: true, expected: 200 },
      { email: "removed@example.test", verifiedGoogle: true, expected: 307 },
      { email: "allowed@example.test", verifiedGoogle: false, expected: 307 },
    ]) {
      const jwt = await encode({ secret, salt: "authjs.session-token", token: { sub: "test-user", email: identity.email, verifiedGoogle: identity.verifiedGoogle }, maxAge: 60 });
      const response = await fetch(origin + route, { redirect: "manual", headers: { cookie: `authjs.session-token=${jwt}` } });
      assert.equal(response.status, identity.expected);
      if (identity.expected === 200) {
        const html = await response.text();
        assert.ok(html.includes(route === "/patients" ? "Search name, ID or treatment" : route === "/upload" ? "Posting permission" : route === "/admin" ? "Clinic settings" : "Search title or notes"), `Authenticated ${route} must render its expected controls`);
        assert.ok(html.includes("Sign out"));
        if (route === "/patients") assert.ok(html.includes("Filter by collection") && html.includes("Favorites") && html.includes("Celebrities"));
        if (route === "/other-uploads") assert.ok(!html.includes("Filter by collection"));
        if(route==="/upload"){
          for(const text of ["Treatment","Uploaded by","Save to Drive","Choose several together"])assert.ok(html.includes(text));
          assert.ok(html.includes('multiple=""'));
          assert.ok(html.includes("Storage setup is in progress"));
        }
      }
    }
  }
  const generalJwt=await encode({secret,salt:"authjs.session-token",token:{sub:"test-user",email:"allowed@example.test",verifiedGoogle:true},maxAge:60});
  const general=await (await fetch(origin+"/upload?type=general",{headers:{cookie:`authjs.session-token=${generalJwt}`}})).text();
  assert.ok(general.includes("e.g. Office tour"));assert.ok(!general.includes("Posting permission"));
  console.info("Authenticated route checks passed: Google sign-in requests account selection with PKCE; libraries and upload form reject removed/unverified accounts; patient fields, consent, multiple files and general-upload mode render.");
} finally { server.kill("SIGTERM"); await rm(fixtures, { recursive: true, force: true }); }
