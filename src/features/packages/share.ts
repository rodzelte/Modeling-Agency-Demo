import { createHash, randomBytes } from "node:crypto";

// Package links: a random 256-bit token goes in the URL; only its SHA-256 hash
// is stored, so a database leak never exposes working links.
export function newShareToken() {
  return randomBytes(32).toString("base64url");
}

export function hashShareToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export const isShareToken = (value: string) => /^[A-Za-z0-9_-]{40,64}$/.test(value);

