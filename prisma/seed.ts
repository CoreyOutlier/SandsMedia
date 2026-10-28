import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type MediaLabel } from "../src/generated/prisma/client.ts";
import { CONSENT_TEXT, CONSENT_TEXT_VERSION } from "../src/lib/consent.ts";

type Fixture = { id: string; name: string; sessions: { date: string; tx: string; notes: string; by: string; consent: boolean; status: "hold" | "ready" | "posted"; quote?: string; photos: { k: MediaLabel; v?: boolean }[] }[] };
function id(key: string) {
  const value = createHash("sha256").update(`posting-center-fixture:${key}`).digest("hex").slice(0, 32).split("");
  value[12] = "4"; value[16] = "8";
  return `${value.slice(0,8).join("")}-${value.slice(8,12).join("")}-${value.slice(12,16).join("")}-${value.slice(16,20).join("")}-${value.slice(20).join("")}`;
}

async function main() {
  const url = process.env.DATABASE_URL;
  const hash = process.env.SEED_CLINIC_PASSCODE_HASH;
  const drive = process.env.DRIVE_ROOT_FOLDER_ID;
  const demo = process.env.SEED_DEMO_DATA === "true";
  if (!url || !hash || !/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(hash) || !drive) throw new Error("SEED_CONFIGURATION_REQUIRED");
  if (demo && (process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production")) throw new Error("DEMO_SEED_FORBIDDEN");
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }), log: [] });
  try {
    const clinic = await db.clinic.upsert({
      where: { slug: process.env.CLINIC_SLUG ?? "dr-sands" },
      create: { name: "Dr. Sands, Beverly Hills", slug: process.env.CLINIC_SLUG ?? "dr-sands", uploadPasscodeHash: hash, driveRootFolderId: drive, nextPatientNumber: demo ? 142 : 1 },
      update: {},
    });
    if (!demo) { console.info("Clinic initialization completed; no patient fixtures inserted."); return; }
    // Never reset or delete existing data, including immutable consent records.
    if (await db.patient.count({ where: { clinicId: clinic.id } })) {
      console.info("Fixture seed skipped: clinic already contains patient records."); return;
    }
    const fixtures = JSON.parse(await readFile(new URL("./fixtures/patients.json", import.meta.url), "utf8")) as Fixture[];
    await db.$transaction(async tx => {
      for (const p of fixtures) {
        const [firstName, ...lastName] = p.name.split(" ");
        const patientId = id(p.id);
        await tx.patient.create({ data: { id: patientId, clinicId: clinic.id, displayId: p.id, firstName, lastName: lastName.join(" "), driveFolderId: `fixture-patient-${p.id}` } });
        for (const [sessionIndex, s] of p.sessions.entries()) {
          const sessionId = id(`${p.id}:session:${sessionIndex}`);
          const at = new Date(`${s.date}T12:00:00.000Z`);
          await tx.session.create({ data: { id: sessionId, uploadId: sessionId, patientId, date: at, treatment: s.tx, description: s.notes, testimonialQuote: s.quote, uploadedBy: s.by, status: s.status, driveFolderId: `fixture-session-${sessionId}`, finishedAt: at } });
          const counters: Record<string, number> = {};
          for (const [position, m] of s.photos.entries()) {
            counters[m.k] = (counters[m.k] ?? 0) + 1;
            await tx.media.create({ data: { id: id(`${sessionId}:media:${position}`), sessionId, kind: m.v ? "video" : "photo", label: m.k, fileName: `${m.k}-${String(counters[m.k]).padStart(2,"0")}.${m.v ? "mp4" : "jpg"}`, driveFileId: `fixture-media-${sessionId}-${position}`, position, width: m.v ? 1920 : 2048, height: m.v ? 1080 : 1536, durationS: m.v ? 30 : null, bytes: BigInt(m.v ? 15000000 : 1000000) } });
          }
          if (s.consent) await tx.consentEvent.create({ data: { id: id(`${sessionId}:consent`), sessionId, consented: true, formOnFile: true, consentTextVersion: CONSENT_TEXT_VERSION, consentText: CONSENT_TEXT, consentedBy: s.by, ip: "127.0.0.1", userAgent: "Posting Center development fixture", createdAt: at } });
        }
      }
      await tx.clinic.update({ where: { id: clinic.id }, data: { nextPatientNumber: 142 } });
    });
    console.info("Development fixtures inserted: 8 patients, 11 sessions, 24 photos, 3 videos.");
  } finally { await db.$disconnect(); }
}
main().catch(() => { console.error("SEED_FAILED: verify the target database and seed configuration."); process.exitCode = 1; });
