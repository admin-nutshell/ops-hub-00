import { Langfuse } from "langfuse-node";

const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
const secretKey = process.env.LANGFUSE_SECRET_KEY;
const baseUrl = process.env.LANGFUSE_HOST ?? "https://cloud.langfuse.com";

// Guard: do not initialize if keys are absent (CI has no keys; unit tests must not throw)
export const langfuse: Langfuse | null =
  publicKey && secretKey ? new Langfuse({ publicKey, secretKey, baseUrl }) : null;

/**
 * Emit a single named trace to LangFuse and flush it.
 * No-ops when keys are absent (CI / local dev without keys).
 */
export async function emitTrace(name: string, metadata?: Record<string, unknown>): Promise<void> {
  if (!langfuse) return;
  langfuse.trace({ name, metadata });
  await langfuse.flushAsync();
}
