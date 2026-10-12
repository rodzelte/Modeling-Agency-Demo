import { redirectTo } from "@/lib/api";
import { JOIN_URL } from "@/lib/site";

// /join is the address to share; the form itself is hosted on GoHighLevel.
// (In demo mode JOIN_URL is a page on this site that explains the step.)
export function GET() {
  return redirectTo(JOIN_URL, 307);
}
