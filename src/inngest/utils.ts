import { Pool } from "pg";

export type Urgency = "critical" | "high" | "normal" | "low";
export const URGENCIES = new Set<string>(["critical", "high", "normal", "low"]);

// Escape XML-special characters so ticket content cannot break prompt delimiters.
export function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function createLazyPool(envVar: string, max = 2) {
  let pool: Pool | null = null;
  return {
    get(): Pool {
      if (!pool) {
        const url = process.env[envVar];
        if (!url) throw new Error(`${envVar} is not set`);
        pool = new Pool({ connectionString: url, max });
      }
      return pool;
    },
    reset(mock?: Pool): void {
      pool = mock ?? null;
    },
  };
}
