// Signing secret for sandbox sessions and signed file links. On a serverless
// host every function of one deployment shares the value generated at build
// time (next.config.ts), so a session survives the sandbox being restarted;
// otherwise it is random per server start. This module loads nothing else, so
// reading the secret never starts (or even loads) the sandbox database.
const SECRET = Symbol.for("42mm.demo.secret");
const secrets = globalThis as unknown as Record<symbol, string | undefined>;

export function sandboxSecret(): string {
  return (secrets[SECRET] ??= process.env.DEMO_SANDBOX_SECRET || process.env.DEMO_INTERNAL_SECRET || crypto.randomUUID() + crypto.randomUUID());
}
