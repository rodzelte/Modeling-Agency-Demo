// Shared by the emailed-code routes (migration 028). The nonce cookie ties the
// code to the browser that signed in with the password; only its hash is stored.
export const NONCE_COOKIE = "mfa_email_nonce";
export const NONCE_COOKIE_PATH = "/api/auth/email-code";

export const nonceCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: NONCE_COOKIE_PATH,
  maxAge: 600,
};

// "marie@42modelmanagement.com" → "m•••e@42modelmanagement.com"
export function maskEmail(email: string) {
  const [name, domain] = email.split("@");
  if (!domain) return email;
  return `${name.length <= 2 ? name[0] ?? "" : `${name[0]}•••${name[name.length - 1]}`}@${domain}`;
}
