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
        assert.ok(html.includes(route === "/patients" ? "Search name, ID or treatment" : route === "/upload" ? "Consent for posting and sharing" : route === "/admin" ? "Clinic settings" : "Search title or notes"), `Authenticated ${route} must render its expected controls`);
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
  assert.ok(general.includes("e.g. Office tour"));assert.ok(!general.includes("Consent for posting and sharing"));
  console.info("Authenticated route checks passed: libraries and upload form reject removed/unverified accounts; patient fields, consent, multiple files and general-upload mode render.");
} finally { server.kill("SIGTERM"); }
