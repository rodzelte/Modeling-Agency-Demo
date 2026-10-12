// Board pages include talent on sub-boards ("Women" lists Women / Fashion, …).
import { test } from "node:test";
import assert from "node:assert/strict";
import { boardAndDescendantPaths, cardBoard } from "../../src/features/public/board-paths.ts";

const boards = [{ path: "women" }, { path: "women/fashion" }, { path: "women/commercial" }, { path: "womenswear" }, { path: "men" }, { path: "men/fashion" }];

test("a parent board includes its sub-boards, not look-alike names", () => {
  assert.deepEqual(boardAndDescendantPaths(boards, "women"), ["women", "women/fashion", "women/commercial"]);
  assert.deepEqual(boardAndDescendantPaths(boards, "women/fashion"), ["women/fashion"]);
});

test("cards are labelled with the board being viewed, else its sub-board", () => {
  const talentBoards = [{ path: "fitness-athletics", name: "Fitness & Athletics" }, { path: "men/commercial", name: "Men / Commercial" }];
  assert.equal(cardBoard(talentBoards, "men")?.name, "Men / Commercial");
  assert.equal(cardBoard(talentBoards, "fitness-athletics")?.name, "Fitness & Athletics");
  assert.equal(cardBoard(talentBoards)?.name, "Fitness & Athletics");
});
