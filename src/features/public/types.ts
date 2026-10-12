// Shapes used by the public website. Built only from the public-safe views
// (migration 017) or, for staff previews, from the same public-safe fields.
export type PublicBoard = {
  id: string;
  name: string;
  slug: string;
  path: string;
  depth: number;
  parent_id: string | null;
  description: string | null;
  website_section: string | null;
  show_in_navigation: boolean;
  sort_order: number;
};

export type TalentCardData = {
  id: string;
  slug: string;
  name: string;
  location: string;
  height: string | null;
  boardLabel: string;
  image: string;
  imageAlt: string;
  featured: boolean;
  boardPaths: string[];
};

export type ProfileImage = { src: string; alt: string };

export type PublicProfile = {
  id: string;
  slug: string;
  name: string;
  firstName: string;
  lastName: string;
  location: string;
  gender: string;
  age: number | null;
  bio: string;
  image: string;
  imageAlt: string;
  boards: { name: string; path: string }[];
  stats: { label: string; value: string }[];
  gallery: ProfileImage[];
  portfolios: { id: string; name: string; kind: "portfolio" | "digitals"; images: ProfileImage[] }[];
  videos: { id: string; title: string; provider: string; externalId: string | null; src: string | null }[];
  skills: { category: string; skill: string; level: string | null }[];
};

export const PLACEHOLDER_IMAGE = "/placeholder-talent.svg";
// Talent photos are already compressed once, so the site re-encodes them at high
// quality (next.config.ts allows 75 and 90).
export const PHOTO_QUALITY = 90;
