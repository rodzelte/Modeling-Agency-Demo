// Emulates the Supabase Storage endpoints this app calls. Object rows live in the
// sandbox's storage.objects table, so the real storage RLS policies decide who
// may upload, read, copy or delete; the bytes live in this server's memory.
import { getSandbox, lit, runAs, runAsSystem, SandboxError, type Caller } from "./database.ts";
import { signToken, verifyToken } from "./jwt.ts";
import type { SandboxRequest } from "./rest.ts";

type Bucket = { id: string; public: boolean; file_size_limit: number | null; allowed_mime_types: string[] | null };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function storageError(status: number, error: string, message: string) {
  return json({ statusCode: String(status), error, message }, status);
}

const notFound = () => storageError(400, "not_found", "Object not found");

async function bucketById(id: string): Promise<Bucket | null> {
  return runAsSystem(async (tx) => {
    const found = (await tx.query<{ body: string | null }>(`select row_to_json(b)::text as body from storage.buckets b where id = ${lit(id)}`)).rows[0]?.body;
    return found ? (JSON.parse(found) as Bucket) : null;
  });
}

// Splits "<bucket>/<object name>", keeping the name exactly as stored.
function splitPath(path: string): [bucket: string, name: string] {
  const decoded = path.split("/").map((segment) => decodeURIComponent(segment));
  return [decoded[0] ?? "", decoded.slice(1).join("/")];
}

function parseJson(request: SandboxRequest): Record<string, unknown> {
  if (!request.body?.byteLength) return {};
  try {
    return JSON.parse(Buffer.from(request.body).toString("utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function visible(caller: Caller, bucket: string, names: string[]): Promise<Set<string>> {
  if (!names.length) return new Set();
  return runAs(caller, async (tx) => {
    const rows = await tx.query<{ name: string }>(`select name from storage.objects where bucket_id = ${lit(bucket)} and name in (${names.map(lit).join(", ")})`);
    return new Set(rows.rows.map((row) => row.name));
  });
}

async function serve(bucket: string, name: string, download: string | null, cacheControl: string) {
  const file = (await getSandbox()).files.get(`${bucket}/${name}`);
  if (!file) return notFound();
  const headers: Record<string, string> = { "content-type": file.contentType, "content-length": String(file.bytes.byteLength), "cache-control": cacheControl, "x-content-type-options": "nosniff" };
  if (download !== null) headers["content-disposition"] = `attachment; filename="${(download || name.split("/").pop() || "file").replace(/[^\w.\- ]/g, "_")}"`;
  return new Response(Buffer.from(file.bytes), { status: 200, headers });
}

async function upload(request: SandboxRequest, caller: Caller, bucketId: string, name: string): Promise<Response> {
  const bucket = await bucketById(bucketId);
  if (!bucket || !name) return storageError(400, "Bucket not found", "Bucket not found");
  let bytes = request.body ?? new Uint8Array();
  let contentType = request.headers.get("content-type") ?? "application/octet-stream";
  if (contentType.startsWith("multipart/form-data")) {
    const form = await new Response(Buffer.from(bytes), { headers: { "content-type": contentType } }).formData();
    const file = [...form.values()].find((value): value is File => typeof value !== "string");
    if (!file) return storageError(400, "invalid_request", "No file was uploaded");
    bytes = new Uint8Array(await file.arrayBuffer());
    contentType = file.type || "application/octet-stream";
  }
  contentType = contentType.split(";")[0].trim().toLowerCase();
  if (bucket.file_size_limit && bytes.byteLength > Number(bucket.file_size_limit)) return storageError(413, "Payload too large", "The object exceeded the maximum allowed size");
  if (bucket.allowed_mime_types?.length && !bucket.allowed_mime_types.includes(contentType)) return storageError(415, "invalid_mime_type", `mime type ${contentType} is not supported`);

  const upsert = request.headers.get("x-upsert") === "true";
  const metadata = lit({ size: bytes.byteLength, mimetype: contentType });
  const owner = caller.role === "authenticated" ? lit(caller.claims?.sub) : "null";
  const id = await runAs(caller, async (tx) => {
    const rows = await tx.query<{ id: string }>(`insert into storage.objects (bucket_id, name, owner, metadata) values (${lit(bucketId)}, ${lit(name)}, ${owner}, ${metadata}::jsonb)
      ${upsert ? "on conflict (bucket_id, name) do update set metadata = excluded.metadata, updated_at = now()" : ""} returning id`);
    return rows.rows[0]?.id;
  });
  (await getSandbox()).files.set(`${bucketId}/${name}`, { bytes, contentType });
  return json({ Id: id, Key: `${bucketId}/${name}` });
}

async function copyOrMove(request: SandboxRequest, caller: Caller, move: boolean): Promise<Response> {
  const input = parseJson(request);
  const sourceBucket = String(input.bucketId ?? "");
  const sourceKey = String(input.sourceKey ?? "");
  const destinationBucket = String(input.destinationBucket ?? sourceBucket);
  const destinationKey = String(input.destinationKey ?? "");
  if (!(await visible(caller, sourceBucket, [sourceKey])).has(sourceKey)) return notFound();
  const sandbox = await getSandbox();
  const file = sandbox.files.get(`${sourceBucket}/${sourceKey}`);
  if (!file || !destinationKey || !(await bucketById(destinationBucket))) return notFound();
  const owner = caller.role === "authenticated" ? lit(caller.claims?.sub) : "null";
  await runAs(caller, async (tx) => {
    await tx.query(`insert into storage.objects (bucket_id, name, owner, metadata) values (${lit(destinationBucket)}, ${lit(destinationKey)}, ${owner}, ${lit({ size: file.bytes.byteLength, mimetype: file.contentType })}::jsonb)`);
    if (move) await tx.query(`delete from storage.objects where bucket_id = ${lit(sourceBucket)} and name = ${lit(sourceKey)}`);
  });
  sandbox.files.set(`${destinationBucket}/${destinationKey}`, file);
  if (move) sandbox.files.delete(`${sourceBucket}/${sourceKey}`);
  return json(move ? { message: "Successfully moved" } : { Key: `${destinationBucket}/${destinationKey}` });
}

async function list(request: SandboxRequest, caller: Caller, bucket: string): Promise<Response> {
  const input = parseJson(request);
  const prefix = String(input.prefix ?? "").replace(/^\/+|\/+$/g, "");
  const limit = Math.min(Number(input.limit ?? 100) || 100, 1000);
  const offset = Number(input.offset ?? 0) || 0;
  const sort = (input.sortBy ?? {}) as { column?: string; order?: string };
  const column = ["name", "created_at", "updated_at"].includes(sort.column ?? "") ? sort.column! : "name";
  const direction = sort.order === "desc" ? "desc" : "asc";
  const under = prefix ? `${prefix}/` : "";
  const rows = await runAs(caller, async (tx) => (await tx.query<{ body: string }>(`select coalesce(json_agg(row_to_json(o)), '[]')::text as body from (
      select id, name, metadata, created_at, updated_at from storage.objects
      where bucket_id = ${lit(bucket)} and name like ${lit(`${under.replace(/[\\%_]/g, "\\$&")}%`)} order by ${column} ${direction}) o`)).rows[0].body);
  // One level only: files directly under the prefix, and each sub-folder once.
  const seen = new Set<string>();
  const entries: Record<string, unknown>[] = [];
  for (const row of JSON.parse(rows) as { id: string; name: string; metadata: unknown; created_at: string; updated_at: string }[]) {
    const [first, ...deeper] = row.name.slice(under.length).split("/");
    if (!first || seen.has(first)) continue;
    seen.add(first);
    entries.push(deeper.length
      ? { name: first, id: null, updated_at: null, created_at: null, last_accessed_at: null, metadata: null }
      : { name: first, id: row.id, updated_at: row.updated_at, created_at: row.created_at, last_accessed_at: row.updated_at, metadata: row.metadata });
  }
  return json(entries.slice(offset, offset + limit));
}

export async function handleStorage(request: SandboxRequest, caller: Caller, path: string): Promise<Response> {
  const route = path.replace(/^\/+|\/+$/g, "");
  const { method } = request;
  if (!route.startsWith("object")) throw new SandboxError("demo_storage_unsupported", `Storage endpoint not available in demo mode: ${method} /${route}`, 404);
  const rest = route.slice("object".length).replace(/^\/+/, "");

  if (method === "GET" || method === "HEAD") {
    if (rest.startsWith("public/")) {
      const [bucketId, name] = splitPath(rest.slice("public/".length));
      const bucket = await bucketById(bucketId);
      return bucket?.public ? serve(bucketId, name, request.url.searchParams.get("download"), "public, max-age=300") : notFound();
    }
    if (rest.startsWith("sign/")) {
      const [bucketId, name] = splitPath(rest.slice("sign/".length));
      const claims = verifyToken(request.url.searchParams.get("token") ?? "");
      if (claims?.url !== `${bucketId}/${name}`) return storageError(400, "InvalidJWT", "The signed link has expired or is not valid");
      return serve(bucketId, name, request.url.searchParams.get("download"), "private, no-store");
    }
    const [bucketId, name] = splitPath(rest.replace(/^authenticated\//, ""));
    if (!(await visible(caller, bucketId, [name])).has(name)) return notFound();
    return serve(bucketId, name, request.url.searchParams.get("download"), "private, no-store");
  }

  if (method === "POST" && rest === "copy") return copyOrMove(request, caller, false);
  if (method === "POST" && rest === "move") return copyOrMove(request, caller, true);
  if (method === "POST" && rest.startsWith("list/")) return list(request, caller, splitPath(rest.slice("list/".length))[0]);

  if (method === "POST" && rest.startsWith("sign/")) {
    const [bucketId, name] = splitPath(rest.slice("sign/".length));
    const input = parseJson(request);
    const expiresIn = Math.max(1, Number(input.expiresIn ?? 60) || 60);
    // Unencoded, like the real API: storage-js applies encodeURI to the whole link.
    const link = (object: string) => `/object/sign/${bucketId}/${object}?token=${signToken({ url: `${bucketId}/${object}` }, expiresIn)}`;
    if (Array.isArray(input.paths)) {
      const paths = input.paths.map(String);
      const readable = await visible(caller, bucketId, paths);
      return json(paths.map((object) => readable.has(object) ? { error: null, path: object, signedURL: link(object) } : { error: "Either the object does not exist or you do not have access to it", path: object, signedURL: null }));
    }
    if (!(await visible(caller, bucketId, [name])).has(name)) return notFound();
    return json({ signedURL: link(name) });
  }

  if (method === "POST" || method === "PUT") {
    const [bucketId, name] = splitPath(rest);
    return upload(request, caller, bucketId, name);
  }

  if (method === "DELETE") {
    const [bucketId, single] = splitPath(rest);
    const input = parseJson(request);
    const names = Array.isArray(input.prefixes) ? input.prefixes.map(String) : single ? [single] : [];
    if (!names.length) return json([]);
    const removed = await runAs(caller, async (tx) => (await tx.query<{ name: string }>(`delete from storage.objects where bucket_id = ${lit(bucketId)} and name in (${names.map(lit).join(", ")}) returning name`)).rows.map((row) => row.name));
    const sandbox = await getSandbox();
    for (const name of removed) sandbox.files.delete(`${bucketId}/${name}`);
    return json(removed.map((name) => ({ name, bucket_id: bucketId })));
  }

  throw new SandboxError("demo_storage_unsupported", `Storage endpoint not available in demo mode: ${method} /${route}`, 404);
}
