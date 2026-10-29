import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const state = globalThis as unknown as { database?: PrismaClient };

export function database(): PrismaClient {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_UNAVAILABLE");
  if (!state.database) state.database = new PrismaClient({
    adapter: new PrismaPg({ connectionString: url, connectionTimeoutMillis: 20000, idleTimeoutMillis: 60000, keepAlive: true }),
    transactionOptions: { maxWait: 10000, timeout: 20000 },
    log: [],
    errorFormat: "minimal",
  });
  return state.database;
}
