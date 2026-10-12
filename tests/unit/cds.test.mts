// CDS import rules. Run: npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { isCdsMediaUrl, isExcludedName, matchTalent, measurementRow, normalizeLocation, pickCover, planPortfolioBoard, selectPhotos, type BoardRef, type MatchCandidate } from "../../src/features/cds/logic.ts";
import { talentSummary } from "../../src/features/talent/summary.ts";

test("agency placeholder records are excluded", () => {
  assert.equal(isExcludedName("***MODEL LUXE", "MEDIA"), true);
  assert.equal(isExcludedName("*42 MODEL", "MANAGEMENT"), true);
  assert.equal(isExcludedName("Alayla", "Weatherspoon"), false);
});

const alayla: MatchCandidate = { id: "t1", firstName: "Alayla", lastName: "Weatherspoon", email: "alaylasimone@gmail.com", phones: ["(682) 597-7125"], dateOfBirth: "2002-09-25" };
const other: MatchCandidate = { id: "t2", firstName: "Emily", lastName: "Short", email: null, phones: [], dateOfBirth: null };

test("matching prefers email, then phone, then a unique full name", () => {
  const input = { firstName: "Alayla", lastName: "Weatherspoon", email: "AlaylaSimone@gmail.com", phone: null, dateOfBirth: null };
  assert.deepEqual(matchTalent(input, [alayla, other]), { kind: "match", id: "t1", reason: "email" });
  assert.deepEqual(matchTalent({ ...input, email: null, phone: "+1 682 597 7125" }, [alayla]), { kind: "match", id: "t1", reason: "phone" });
  assert.deepEqual(matchTalent({ ...input, email: null }, [alayla]), { kind: "match", id: "t1", reason: "name" });
  assert.deepEqual(matchTalent({ ...input, email: "someone@else.com", firstName: "Brooklyn", lastName: "Ford" }, [alayla, other]), { kind: "none" });
});

test("uncertain matches go to review instead of creating a duplicate", () => {
  const input = { firstName: "Alayla", lastName: "Weatherspoon", email: null, phone: null, dateOfBirth: "2001-01-01" };
  assert.equal(matchTalent(input, [alayla]).kind, "review", "date of birth disagrees");
  assert.equal(matchTalent({ ...input, dateOfBirth: null }, [alayla, { ...alayla, id: "t3" }]).kind, "review", "two people with the name");
  assert.equal(matchTalent({ ...input, email: "alaylasimone@gmail.com", firstName: "Nakima" }, [alayla]).kind, "none", "email alone needs the same first name");
});

const boards: BoardRef[] = [
  { id: "women", name: "Women", parentId: null, segment: "women" },
  { id: "women-fashion", name: "Women / Fashion", parentId: "women", segment: "fashion" },
  { id: "women-curve", name: "Women / Curve", parentId: "women", segment: "curve" },
  { id: "men", name: "Men", parentId: null, segment: "men" },
  { id: "teens", name: "Teens", parentId: null, segment: "teens" },
  { id: "teens-boys", name: "Teens / Boys", parentId: "teens", segment: "boys" },
];

test("CDS portfolios map to existing website boards, or plan a new one", () => {
  assert.deepEqual(planPortfolioBoard("Fashion-Women", boards), { portfolio: "Fashion-Women", kind: "existing", boardId: "women-fashion" });
  assert.deepEqual(planPortfolioBoard("Commercial-Women", boards), { portfolio: "Commercial-Women", kind: "create", parentName: "Women", name: "Commercial" });
  assert.deepEqual(planPortfolioBoard("Development - Men", boards), { portfolio: "Development - Men", kind: "create", parentName: "Men", name: "Development" });
  assert.deepEqual(planPortfolioBoard("Teens- Boys", boards), { portfolio: "Teens- Boys", kind: "existing", boardId: "teens-boys" });
  assert.deepEqual(planPortfolioBoard("Teens - Girls", boards), { portfolio: "Teens - Girls", kind: "create", parentName: "Teens", name: "Girls" });
  assert.deepEqual(planPortfolioBoard("Women", boards), { portfolio: "Women", kind: "existing", boardId: "women" });
  assert.deepEqual(planPortfolioBoard("Curve", boards), { portfolio: "Curve", kind: "existing", boardId: "women-curve" });
  assert.deepEqual(planPortfolioBoard("Fitness & Athletics", boards), { portfolio: "Fitness & Athletics", kind: "create", parentName: null, name: "Fitness & Athletics" });
});

test("measurements are read from CDS text values", () => {
  assert.deepEqual(measurementRow({ height_cm: "175 cm", bust_cm: "81 cm", waist_cm: "61 cm", hips_cm: "90 cm", shoe_us: "8.5", hair_color: "Dark Brown", eyes_color: "Brown", dress_size_us: "0-2", head_cm: "..." }), {
    height_cm: 175, bust_chest_cm: 81, waist_cm: 61, hips_cm: 90, shoe_size_us: "8.5", hair_color: "Dark Brown", hair_length: null, hair_type: null,
    eye_color: "Brown", body_type: null, dress_size: "0-2", collar_cm: null, head_cm: null,
  });
  assert.equal(measurementRow({ height_cm: "...", hair_color: "" }), null);
});

test("CDS locations are tidied, placeholders become Location TBA", () => {
  assert.equal(normalizeLocation("Fort worth"), "Fort Worth");
  assert.equal(normalizeLocation("  DALLAS, tx "), "Dallas, TX");
  assert.equal(normalizeLocation("..."), null);
  assert.equal(normalizeLocation("CDS"), null);
  assert.equal(normalizeLocation("In Town"), "Dallas");
  assert.equal(normalizeLocation(null), null);
  assert.equal(talentSummary(null, "Female", 22), "Location TBA · Female · 22 yrs");
  assert.equal(talentSummary("Dallas", "Female", 37), "Dallas · Female · 37 yrs");
  assert.equal(talentSummary("", null, null), "Location TBA");
});

test("photo copy takes portfolios, digitals and the cover, not the whole library", () => {
  const media = [
    { id: "1", kind: "image" as const, position: 0, metadata: { web: true } },
    { id: "2", kind: "image" as const, position: 1, metadata: { primary: true } },
    { id: "3", kind: "image" as const, position: 2, metadata: {} },
    { id: "4", kind: "digital" as const, position: 3, metadata: {} },
    { id: "5", kind: "video" as const, position: 0, metadata: {} },
  ];
  assert.deepEqual(selectPhotos(media, [{ name: "Fashion-Women", media: ["3"] }]), ["2", "3", "4"]);
  // No portfolio: the WEB-marked photos keep the talent from having no pictures.
  assert.deepEqual(selectPhotos(media, []), ["1", "2", "4"]);
  assert.equal(pickCover(media, [{ name: "A", media: ["3"] }], new Set(["2", "3"])), "2");
  assert.equal(pickCover(media, [{ name: "A", media: ["3"] }], new Set(["3"])), "3");
});

test("only the CDS media bucket is fetched", () => {
  assert.equal(isCdsMediaUrl(new URL("https://cds-ob-619779309805-private-bucket.s3.eu-west-1.amazonaws.com/uploads/x.jpg?X-Amz-Expires=1")), true);
  assert.equal(isCdsMediaUrl(new URL("https://evil.s3.eu-west-1.amazonaws.com/x.jpg")), false);
  assert.equal(isCdsMediaUrl(new URL("http://cds-ob-619779309805-private-bucket.s3.eu-west-1.amazonaws.com/x.jpg")), false);
  assert.equal(isCdsMediaUrl(new URL("https://169.254.169.254/latest")), false);
});
