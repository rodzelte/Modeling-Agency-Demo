export type MediaPhoto = {
  id: string;
  url: string | null;
  title: string | null;
  alt_text: string | null;
  photographer: string | null;
  type_of_work: string | null;
  support_name: string | null;
  country_of_publication: string | null;
  image_type: string;
  display_order: number;
  featured: boolean;
  public: boolean;
  archived_at: string | null;
  focal_point: { x: number; y: number } | null;
  review_status?: "approved" | "pending" | "rejected";
  uploaded_by_talent?: boolean;
};

export type MediaVideo = {
  id: string;
  title: string | null;
  provider: "youtube" | "vimeo" | "upload";
  external_id: string | null;
  url: string | null;
  public: boolean;
  display_order: number;
};

export type MediaCollection = {
  id: string;
  kind: "portfolio" | "book";
  name: string;
  slug: string | null;
  description: string | null;
  public: boolean;
  is_default: boolean;
  photo_ids: string[];
};

export const PHOTO_COLUMNS = "id,storage_bucket,storage_path,public_storage_path,title,alt_text,photographer,type_of_work,support_name,country_of_publication,image_type,display_order,featured,public,archived_at,focal_point,created_at,review_status,uploaded_by_talent";

export const IMAGE_TYPES = ["portfolio", "digital", "polaroid", "editorial", "campaign", "headshot", "comp"].map((value) => ({ value, label: value[0].toUpperCase() + value.slice(1) }));

export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
export const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
