import { defineConfig } from "prisma/config";

// Build/generate/validate work without production credentials. Migration commands
// require DATABASE_URL in the command's environment; there is no fallback database.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations", seed: "node --experimental-strip-types prisma/seed.ts" },
  datasource: { url: process.env.DATABASE_URL ?? "" },
});
