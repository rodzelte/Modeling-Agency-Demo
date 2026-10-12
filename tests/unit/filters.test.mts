// Pure roster-filter logic (src/features/public/filters.ts). Run: npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { activeFilterCount, parseRosterFilters, rosterQuery } from "../../src/features/public/filters.ts";

test("parses and coerces valid filters", () => {
  const filters = parseRosterFilters({ board: "teens/boys", heightMin: "170", ageMax: "25", hair: "Brown", page: "2", sort: "name" });
  assert.deepEqual(filters, { board: "teens/boys", heightMin: 170, ageMax: 25, hair: "Brown", page: 2, sort: "name" });
});

test("drops invalid values instead of failing the whole search", () => {
  const filters = parseRosterFilters({ heightMin: "abc", ageMax: "500", board: "../etc", sort: "random", page: "-1", gender: "Male" });
  assert.deepEqual(filters, { gender: "Male" });
});

test("strips characters that could alter the PostgREST filter", () => {
  const filters = parseRosterFilters({ q: "sam),id.eq.1,(x%_*", location: "Dallas*" });
  assert.equal(filters.q, "sam id.eq.1 x");
  assert.equal(filters.location, "Dallas");
});

test("builds a stable, shareable query string", () => {
  assert.equal(rosterQuery({ hair: "Brown", board: "teens", page: 1, sort: "featured" }), "?board=teens&hair=Brown");
  assert.equal(rosterQuery({ board: "teens" }, { page: 3 }), "?board=teens&page=3");
  assert.equal(rosterQuery({}), "");
});

test("round-trips through the URL", () => {
  const filters = { board: "fashion/women", heightMin: 175, skill: "Swimming", sort: "newest" as const, page: 2 };
  const parsed = parseRosterFilters(Object.fromEntries(new URLSearchParams(rosterQuery(filters))));
  assert.deepEqual(parsed, filters);
});

test("counts active filters without page and sort", () => {
  assert.equal(activeFilterCount({ board: "teens", hair: "Brown", page: 4, sort: "name" }), 2);
});
