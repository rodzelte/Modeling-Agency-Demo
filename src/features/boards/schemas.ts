import { z } from "zod";
import { optionalBoolean, optionalText, requiredText, slug, uuid } from "@/lib/validation";

export const boardSchema = z.object({
  name: requiredText(120).optional(),
  slug: slug.optional(),
  path_segment: slug.optional(),
  parent_board_id: uuid.nullable().optional().or(z.literal("").transform(() => null)),
  description: optionalText(1000),
  website_section: optionalText(80),
  is_active: optionalBoolean,
  publish_to_website: optionalBoolean,
  internal_only: optionalBoolean,
  show_in_navigation: optionalBoolean,
  is_minor_board: optionalBoolean,
});

export const reorderSchema = z.object({ board_ids: z.array(uuid).min(1).max(200) });
