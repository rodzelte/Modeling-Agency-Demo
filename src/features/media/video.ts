// Parses YouTube / Vimeo links into provider + id, and builds privacy-friendly
// embed URLs for the website.
export function parseVideoUrl(input: string): { provider: "youtube" | "vimeo"; externalId: string } | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\.|^m\./, "");
  if (host === "youtu.be") {
    const id = url.pathname.slice(1).split("/")[0];
    return /^[\w-]{11}$/.test(id) ? { provider: "youtube", externalId: id } : null;
  }
  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const id = url.searchParams.get("v") ?? url.pathname.match(/^\/(?:embed|shorts|live)\/([\w-]{11})/)?.[1] ?? "";
    return /^[\w-]{11}$/.test(id) ? { provider: "youtube", externalId: id } : null;
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const id = url.pathname.match(/(?:^|\/)(\d{6,12})(?:$|\/)/)?.[1];
    return id ? { provider: "vimeo", externalId: id } : null;
  }
  return null;
}

export function embedUrl(provider: string, externalId: string) {
  if (provider === "youtube") return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(externalId)}`;
  if (provider === "vimeo") return `https://player.vimeo.com/video/${encodeURIComponent(externalId)}?dnt=1`;
  return null;
}

export function watchUrl(provider: string, externalId: string) {
  if (provider === "youtube") return `https://www.youtube.com/watch?v=${encodeURIComponent(externalId)}`;
  if (provider === "vimeo") return `https://vimeo.com/${encodeURIComponent(externalId)}`;
  return null;
}
