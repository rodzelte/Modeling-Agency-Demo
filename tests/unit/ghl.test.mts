// GHL → application mapping (src/features/applications/ghl.ts). Run: npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { mapGhlPayload, parseDate, parseHeight, parseLength } from "../../src/features/applications/ghl.ts";

test("parses heights in every common format", () => {
  assert.equal(parseHeight(`5'9"`), 175);
  assert.equal(parseHeight("5’ 9”"), 175);
  assert.equal(parseHeight("5 ft 9 in"), 175);
  assert.equal(parseHeight("5-9"), 175);
  assert.equal(parseHeight("69"), 175);
  assert.equal(parseHeight("175"), 175);
  assert.equal(parseHeight("175cm"), 175);
  assert.equal(parseHeight("1.75m"), 175);
  assert.equal(parseHeight("6'"), 183);
  // Formats found in the agency's GHL data.
  assert.equal(parseHeight("5'9 1/2"), 177);
  assert.equal(parseHeight("5`4"), 163);
  assert.equal(parseHeight("5'7 cm"), 170);
  assert.equal(parseHeight("510"), 178);
  assert.equal(parseHeight("509"), 175);
  assert.equal(parseHeight("512"), null);
  assert.equal(parseHeight("700"), null);
  assert.equal(parseHeight("tall"), null);
  assert.equal(parseHeight("9'9"), null);
});

test("parses body measurements as centimetres", () => {
  assert.equal(parseLength("24"), 61);
  assert.equal(parseLength("24 in"), 61);
  assert.equal(parseLength("61cm"), 61);
  assert.equal(parseLength("86"), 86);
  assert.equal(parseLength("n/a"), null);
});

test("parses dates and rejects the future", () => {
  assert.equal(parseDate("1999-05-14"), "1999-05-14");
  assert.equal(parseDate("05/14/1999"), "1999-05-14");
  assert.equal(parseDate("May 14, 1999"), "1999-05-14");
  assert.equal(parseDate(Date.UTC(1999, 4, 14)), "1999-05-14");
  assert.equal(parseDate("2999-01-01"), null);
  assert.equal(parseDate("soon"), null);
});

test("maps a standard GHL workflow webhook", () => {
  const mapped = mapGhlPayload({
    contact_id: "abc123",
    first_name: "Saih",
    last_name: "Tester",
    email: "SAIH@Example.test",
    phone: "+15555550100",
    date_of_birth: "2010-03-20",
    city: "Dallas",
    state: "TX",
    tags: "join-us, teen",
    "Height": `5'7"`,
    "Measurements (Bust-Waist-Hips)": "32-26-34",
    "Hair Color": "Brown",
    "Eye Color": "Hazel",
    "Instagram Handle": "@saih",
    "Parent/Guardian Name": "Pat Tester",
    "Parent/Guardian Email": "pat@example.test",
    "I agree to receive SMS messages from 42 Model Management": "Yes",
    "Upload Headshot": "https://assets.cdn.filesafe.space/loc/media/headshot.jpg",
    "Full Body Photo": [{ url: "https://assets.cdn.filesafe.space/loc/media/body.jpg" }],
    "3/4 Photo": { "b0e1": { url: "https://assets.cdn.filesafe.space/loc/media/three.jpg", meta: { mimetype: "image/jpeg" } } },
    "How did you hear about us?": "Instagram",
    location: { id: "loc", name: "42" },
    workflow: { id: "wf" },
  });
  assert.equal(mapped.externalId, "abc123");
  assert.equal(mapped.fields.email, "saih@example.test");
  assert.equal(mapped.fields.height_cm, 170);
  assert.equal(mapped.fields.bust_cm, 81.3);
  assert.equal(mapped.fields.waist_cm, 66);
  assert.equal(mapped.fields.hips_cm, 86.4);
  assert.equal(mapped.fields.date_of_birth, "2010-03-20");
  assert.equal(mapped.fields.guardian_name, "Pat Tester");
  assert.equal(mapped.fields.sms_consent, true);
  assert.match(mapped.fields.sms_consent_text ?? "", /SMS messages/);
  assert.deepEqual(mapped.photos.map((photo) => photo.kind), ["headshot", "full_body", "three_quarter"]);
  assert.equal(mapped.extra["How did you hear about us?"], "Instagram");
  assert.equal(mapped.extra.tags, "join-us, teen");
  assert.ok(!("location" in mapped.extra) && !("workflow" in mapped.extra));
  assert.ok(!Object.values(mapped.extra).some((value) => value.includes("filesafe")), "file URLs never land in extra fields");
});

test("maps customData and customFields arrays with an id → label map", () => {
  const mapped = mapGhlPayload({
    contact: { id: "c-9", firstName: "Avery", lastName: "Stone", email: "avery@example.test" },
    customFields: [{ id: "f1", value: "178 cm" }, { id: "f2", value: "No" }],
    customData: { waist: "24" },
  }, { f1: "Height", f2: "SMS consent" });
  assert.equal(mapped.externalId, "c-9");
  assert.equal(mapped.fields.first_name, "Avery");
  assert.equal(mapped.fields.height_cm, 178);
  assert.equal(mapped.fields.waist_cm, 61);
  assert.equal(mapped.fields.sms_consent, false);
});

test("splits a full name when first/last are missing and ignores junk", () => {
  const mapped = mapGhlPayload({ full_name: "Jordan Vale", email: "", phone: null, Height: "unknown" });
  assert.equal(mapped.fields.first_name, "Jordan");
  assert.equal(mapped.fields.last_name, "Vale");
  assert.equal(mapped.fields.email, null);
  assert.equal(mapped.fields.height_cm, null);
});
