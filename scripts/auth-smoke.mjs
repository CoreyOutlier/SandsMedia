import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { encode } from "next-auth/jwt";

// Isolated local test process. No real Google credentials, database or patient data.
const origin = "http://127.0.0.1:3101";
const secret = randomBytes(32).toString("base64url");
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "3101"], {
  env: { ...process.env, DATABASE_URL: "", AUTH_SECRET: secret, AUTH_GOOGLE_ID: "test-client", AUTH_GOOGLE_SECRET: "test-client-secret", APP_URL: origin, ALLOWED_EMAILS: "allowed@example.test" },
  stdio: "ignore",
});
try {
  let ready = false;
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(origin + "/signin")).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(ready, "Isolated test server must start");
  for (const route of ["/patients", "/other-uploads"]) {
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
        assert.ok(html.includes(route === "/patients" ? "Patient directory" : "Your uploads"));
        assert.ok(html.includes("Sign out"));
      }
    }
  }
  console.info("Authenticated route checks passed: both libraries render for an approved verified session, reject removed accounts, and reject unverified sessions.");
} finally { server.kill("SIGTERM"); }
