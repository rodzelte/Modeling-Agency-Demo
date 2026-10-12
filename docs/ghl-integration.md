# GoHighLevel → 42 Model Management integration

> This page covers **Join Us applications**. The full CRM sync (every contact and opportunity, statuses, talent records, photos and conflicts) is in [ghl-sync.md](ghl-sync.md).

The "Join us" form stays on GoHighLevel at `https://funnel.modelluxemedia.com/registration-form`. The website's **Join us** link (and `/join`) points there.

Every submission is copied into the agency system, where staff review it under **Dashboard → Applications** and convert it into a draft talent record with one click.

```mermaid
flowchart LR
  F[GHL registration form] --> W[GHL workflow: Form Submitted → Webhook]
  W -->|POST + shared secret| A[/api/integrations/ghl]
  S[scripts/import-ghl.mjs<br/>past submissions] -->|same endpoint| A
  A --> T[(applications)]
  A -->|downloads, strips GPS/EXIF| B[applications bucket]
  T --> D[Dashboard → Applications]
  D -->|Convert to talent| X[(draft talent + private media)]
```

## 1. One-time setup on the website (Vercel)

Add these **Production** environment variables in Vercel → Settings → Environment Variables, then redeploy.

| Variable | Value | Type |
|---|---|---|
| `SUPABASE_SECRET_KEY` | Supabase → Project Settings → API keys → secret key | Secret |
| `GHL_WEBHOOK_SECRET` | A long random string (at least 24 characters); generate one with `openssl rand -hex 32` | Secret |
| `GHL_FILE_HOSTS` (optional) | Extra hosts for uploaded photos, comma-separated, if GHL stores files somewhere not on the built-in list | Config |

The secret key is used **only** by this integration (`src/lib/supabase/admin.ts`). It never reaches the browser.

## 2. Connect the live form (GHL workflow)

1. In GoHighLevel open **Automation → Workflows → Create workflow → Start from scratch**.
2. **Trigger:** choose **Form Submitted**, filtered to the registration form. If the funnel uses a survey, choose **Survey Submitted** instead.
   - **Several forms:** add one filter per form ("Form is …"), or add a separate trigger for each form in the same workflow. All of them can share the one webhook action below.
3. **Action:** choose **Custom Webhook**. It is the better option, because it sends a header.
   - **Method:** `POST`
   - **URL:** `https://<your-domain>/api/integrations/ghl`
   - **Headers:** `X-Webhook-Secret: <GHL_WEBHOOK_SECRET>`
   - **Content type / body:** JSON, containing all contact fields. The default payload is fine.

   **If only the basic Webhook action is available,** set its URL as above and add a **Custom Data** item: key `webhook_secret`, value = the secret. Never put the secret in the URL.
4. Save and publish the workflow.
5. **Test it:**
   - Submit the form once with test details.
   - Within a few seconds the submission appears under **Dashboard → Applications**, with photos a moment later.
   - Delete or archive the test application afterwards.

### How fields are matched

GHL form labels are matched automatically, ignoring case and punctuation:

| Our field | Recognised GHL labels (examples) |
|---|---|
| Name | First Name, Last Name, Full Name |
| Email, phone | Email, Phone, Mobile, Cell |
| Date of birth | Date of Birth, DOB, Birthday. Minors are flagged automatically. |
| Address | Address, City, State, Postal Code / Zip, Country |
| Instagram | Instagram, Instagram Handle |
| Height | Height. Accepts `5'9"`, `5 ft 9`, `69` (inches), `175` / `175cm` |
| Bust, waist, hips | Bust / Chest, Waist, Hips, or one "Measurements" field like `34-24-34`. Numbers up to 60 are read as inches. |
| Sizes, colouring | Dress Size, Shoe Size, Hair Color, Eye Color |
| Guardian | Parent/Guardian Name, Parent/Guardian Email, Parent/Guardian Phone |
| SMS consent | Any checkbox whose label mentions SMS, text messages, or consent. The label wording is stored as proof of consent. |
| Photos | Upload fields whose label mentions headshot, full body, 3/4, photo, image, or picture |
| Anything else | Kept under **Other answers** on the application, so nothing is lost |

Resubmissions from the same GHL contact update the same application:
- Blank answers never erase earlier ones.
- A rejected or archived application is reopened as **New**, with a note explaining why.

### Photos

- Photos are downloaded from GHL's file storage only. The built-in hosts are `filesafe.space`, `leadconnectorhq.com`, `msgsndr.com`, `storage.googleapis.com` and `firebasestorage.googleapis.com`, plus anything in `GHL_FILE_HOSTS`.
- Each photo is re-encoded as a JPEG, which removes location (GPS) and camera metadata. Large photos are resized to at most 2400px.
- They are stored in the private `applications` bucket and shown to staff through links that expire after 10 minutes.
- A photo that can't be read (for example some iPhone HEIC files) is listed as **Not stored**, with a link to the original in GHL.

## 3. Import past submissions

Use this once to bring existing GHL data in. It is safe to run again, because applications are de-duplicated by GHL contact.

1. **Create a token:** in GHL go to **Settings → Private Integrations → Create new integration**. Grant read-only scopes: contacts, forms, surveys, and custom fields. Copy the token.
2. **Find the IDs:**
   - Location ID: shown in **Settings → Business Profile**, or in the URL of the sub-account.
   - Form (or survey) IDs: once the token and location ID are in `.env.local`, list every form and survey with its ID:

     ```bash
     node --env-file=.env.local scripts/import-ghl.mjs --list-forms
     ```
3. **Set the variables** in `.env.local`. Never commit this file. For several forms, separate the IDs with commas.

   ```env
   GHL_API_TOKEN=...
   GHL_LOCATION_ID=...
   GHL_FORM_ID=formId1,formId2,formId3
   GHL_SURVEY_ID=...                 # only if some are surveys
   GHL_WEBHOOK_SECRET=...            # same value as in Vercel
   IMPORT_TARGET_URL=https://<your-domain>/api/integrations/ghl
   ```
4. **Dry run** (lists what would be sent and changes nothing):

   ```bash
   node --env-file=.env.local scripts/import-ghl.mjs
   ```
5. **Import:**

   ```bash
   node --env-file=.env.local scripts/import-ghl.mjs --apply
   ```

   Options:
   - `--form=id1,id2` to import only these forms this time (ignores `GHL_FORM_ID` and `GHL_SURVEY_ID`; add `--survey=id` for surveys).
   - `--source=surveys` if the IDs in `GHL_FORM_ID` are actually surveys (or use `GHL_SURVEY_ID`).
   - `--source=contacts --tag=<tag>` to import contacts carrying a tag, for example everyone tagged by the Join Us funnel.
   - `--limit=10` to try a few records first.

   **Several forms, same person:** someone who filled in more than one form becomes **one** application. Their answers are combined, and later answers fill in or update earlier ones (blank answers never erase). Each submission's form name appears under **Other answers** as "submitted via".

## 3b. Bring in signed models (Active Talent)

Models already signed in GHL (Talent Recruitment Pipeline → **Active Talent**) become talent records in two steps. The token also needs the `opportunities.readonly` scope.

1. **Import them.** They arrive in Applications already **Approved**, each with a note saying where they came from.

   ```bash
   node --env-file=.env scripts/import-ghl.mjs --stage="Active Talent" --signed
   node --env-file=.env scripts/import-ghl.mjs --stage="Active Talent" --signed --apply
   ```

   The first command is a dry run. Use `--pipeline="<name>"` for a pipeline other than Talent Recruitment Pipeline.
2. **Convert them.** In **Dashboard → Applications**, click **Convert all approved**. Each becomes a **private draft** talent record with contact details, measurements, Instagram and photos (in private media). Then review each record, assign boards and publish when ready.

**Keep it in sync.** Create a second GHL workflow:
- **Trigger:** Pipeline Stage Changed, with pipeline Talent Recruitment Pipeline and stage Active Talent.
- **Action:** Custom Webhook, with the same URL and `X-Webhook-Secret` header as in §2, plus a Custom Data item: key `intake`, value `signed_talent`.

Each newly signed model then appears in Applications as Approved, ready to convert.

## 4. Reviewing applications

**Dashboard → Applications** lists open applications (New, Reviewing, Info requested, Approved).

| Action | What it does |
|---|---|
| Start review / Approve / Request info / Reject / Archive | Changes the status. Every change is recorded in the audit log with who made it. |
| Email | Opens your mail client addressed to the applicant. Follow-up messages can also be sent from GHL. |
| Notes | Internal only. Never shown to the applicant. |
| Convert to talent | Creates a **draft** talent record, including private contact details, measurements, address, Instagram, guardian contact and a note with the applicant's message. Photos are copied into the talent's **private** media. Nothing is published. |

**Who can do what:**
- Talent managers, administrators and the owner can review and convert.
- Bookers can view applications.
- To convert, a user needs `applications.manage`, `talent.create` and `talent.private.edit`. Copying photos also needs `media.manage`.

**Retention:**
- Rejected and archived applications can be purged after 12 months with `select * from purge_stale_applications();`, run as the owner in the Supabase SQL editor. It returns the storage paths to delete from the `applications` bucket.
- Adjust the period to the agency's privacy policy.

## Troubleshooting

| Symptom | Check |
|---|---|
| GHL shows a 401 | The secret in GHL differs from `GHL_WEBHOOK_SECRET`, or it is in the URL instead of the header or Custom Data |
| GHL shows a 503 | `GHL_WEBHOOK_SECRET` isn't set in Vercel, or the site wasn't redeployed after setting it |
| GHL shows a 500 | `SUPABASE_SECRET_KEY` is missing or wrong, or migration `020` hasn't been applied. Vercel logs show `scope: "ghl"`. |
| Application arrives without photos | The file host isn't on the list (add it to `GHL_FILE_HOSTS`), or the file isn't an image. The application lists each failed photo with the reason. |
| A field shows under "Other answers" instead of its own place | Rename the GHL form field to one of the labels above, or ask a developer to add the label to `src/features/applications/ghl.ts` |
