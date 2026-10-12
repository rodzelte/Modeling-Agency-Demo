export type BoardRow = {
  id: string;
  name: string;
  slug: string;
  path_segment: string;
  parent_board_id: string | null;
  description: string | null;
  website_section: string | null;
  is_active: boolean;
  internal_only: boolean;
  publish_to_website: boolean;
  show_in_navigation: boolean;
  is_minor_board: boolean;
  sort_order: number;
};

// label: full breadcrumb ("Teens → Boys"); shortName: the board's own name without
// a repeated parent prefix ("Teens / Boys" under Teens → "Boys").
export type BoardNode = BoardRow & { path: string; depth: number; label: string; shortName: string; isPublic: boolean; children: BoardNode[] };

export const BOARD_COLUMNS = "id,name,slug,path_segment,parent_board_id,description,website_section,is_active,internal_only,publish_to_website,show_in_navigation,is_minor_board,sort_order";

// Arranges flat board rows into a tree with URL paths ("teens/boys") and a flat,
// depth-first ordering for lists and pickers.
export function buildBoardTree(rows: BoardRow[]) {
  const byParent = new Map<string | null, BoardRow[]>();
  for (const row of rows) {
    const key = row.parent_board_id && rows.some((candidate) => candidate.id === row.parent_board_id) ? row.parent_board_id : null;
    byParent.set(key, [...(byParent.get(key) ?? []), row]);
  }
  const sort = (list: BoardRow[]) => [...list].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));

  const flat: BoardNode[] = [];
  const build = (parentId: string | null, parent: BoardNode | null, depth: number): BoardNode[] =>
    sort(byParent.get(parentId) ?? []).map((row) => {
      const shortName = parent && row.name.toLowerCase().startsWith(`${parent.name.toLowerCase()} / `) ? row.name.slice(parent.name.length + 3) : row.name;
      const node: BoardNode = {
        ...row,
        depth,
        shortName,
        path: parent ? `${parent.path}/${row.path_segment}` : row.path_segment,
        label: parent ? `${parent.label} → ${shortName}` : row.name,
        isPublic: row.is_active && row.publish_to_website && !row.internal_only && (parent ? parent.isPublic : true),
        children: [],
      };
      flat.push(node);
      node.children = depth < 6 ? build(row.id, node, depth + 1) : [];
      return node;
    });

  const roots = build(null, null, 0);
  return { roots, flat };
}

// Serializable shape for board pickers in client components.
export function toBoardChoice(board: BoardNode) {
  return { id: board.id, label: board.label, shortName: board.shortName, depth: board.depth, isPublic: board.isPublic, isActive: board.is_active, internalOnly: board.internal_only };
}
