import type { MetadataRoute } from "next";
import { siteOrigin } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  const site = siteOrigin() ?? "http://localhost:3000";
  // A demo site is never indexed.
  if (process.env.NEXT_PUBLIC_DEMO_MODE === "true") return { rules: { userAgent: "*", disallow: "/" } };
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/dashboard", "/portal", "/preview/", "/api/", "/login", "/auth/", "/p/"] },
    sitemap: `${site}/sitemap.xml`,
  };
}
