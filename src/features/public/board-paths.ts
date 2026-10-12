// A board page lists everyone on that board or on any board beneath it, so
// "Women" shows Women / Fashion, Women / Commercial, … as well as talent placed
// on Women directly. Paths are slash-joined segments ("women/commercial").
export function boardAndDescendantPaths(boards: { path: string }[], boardPath: string) {
  return [...new Set([boardPath, ...boards.map((board) => board.path).filter((path) => path.startsWith(`${boardPath}/`))])];
}

// The board a card is labelled with on a board page: that board itself, else
// the first sub-board the talent is on, else their first board.
export function cardBoard<T extends { path: string }>(boards: T[], boardPath?: string) {
  if (!boardPath) return boards[0];
  return boards.find((board) => board.path === boardPath) ?? boards.find((board) => board.path.startsWith(`${boardPath}/`)) ?? boards[0];
}
