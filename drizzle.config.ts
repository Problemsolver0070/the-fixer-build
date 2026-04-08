import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: (() => {
      const url = process.env.DATABASE_URL;
      if (!url) throw new Error("DATABASE_URL environment variable is required for drizzle-kit");
      return url;
    })(),
  },
});
