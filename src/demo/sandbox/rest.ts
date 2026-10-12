// Emulates the subset of the PostgREST API that supabase-js sends for this app:
// selects with embedded relations, filters, ordering, paging and counts; insert,
// update, upsert and delete with returned rows; and RPC. Each request becomes
// one SQL statement run in the sandbox as the caller's role, so RLS, column
// grants and triggers decide the outcome exactly as they do behind PostgREST.
import { cached, ident, lit, runAs, runAsSystem, SandboxError, type Caller } from "./database.ts";

export type SandboxRequest = { method: string; url: URL; headers: Headers; body: Uint8Array | null };

// ---------------------------------------------------------------------------
// Schema catalog (relations, foreign keys, functions), read once per boot
// ---------------------------------------------------------------------------
type ForeignKey = { name: string; table: string; columns: string[]; ref: string; refColumns: string[]; unique: boolean };
type Relation = { columns: Set<string>; pk: string[] };
type Fn = { name: string; args: { name: string; type: string }[]; required: number; set: boolean; returns: "void" | "scalar" | "row" };
type Catalog = { relations: Map<string, Relation>; fks: ForeignKey[]; functions: Map<string, Fn[]> };

const CATALOG_SQL = {
  columns: `select coalesce(json_agg(json_build_object('rel', c.relname, 'col', a.attname)), '[]')::text as body
    from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r','v','m','p') and a.attnum > 0 and not a.attisdropped`,
  pks: `select coalesce(json_agg(json_build_object('rel', c.relname, 'cols',
      (select json_agg(a.attname order by k.ord) from unnest(i.indkey::int2[]) with ordinality k(attnum, ord)
        join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum))), '[]')::text as body
    from pg_index i join pg_class c on c.oid = i.indrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and i.indisprimary`,
  fks: `select coalesce(json_agg(json_build_object('name', c.conname, 'table', cl.relname, 'ref', rcl.relname,
      'columns', (select json_agg(a.attname order by k.ord) from unnest(c.conkey) with ordinality k(attnum, ord)
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum),
      'refColumns', (select json_agg(a.attname order by k.ord) from unnest(c.confkey) with ordinality k(attnum, ord)
        join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum),
      'unique', exists (select 1 from pg_index i where i.indrelid = c.conrelid and i.indisunique and i.indpred is null
        and (select array_agg(x order by x) from unnest(i.indkey::int2[]) x) = (select array_agg(x order by x) from unnest(c.conkey) x)))), '[]')::text as body
    from pg_constraint c
    join pg_class cl on cl.oid = c.conrelid join pg_namespace n on n.oid = cl.relnamespace
    join pg_class rcl on rcl.oid = c.confrelid join pg_namespace rn on rn.oid = rcl.relnamespace
    where c.contype = 'f' and n.nspname = 'public' and rn.nspname = 'public'`,
  functions: `select coalesce(json_agg(json_build_object('name', p.proname, 'set', p.proretset, 'nargs', p.pronargs, 'ndefaults', p.pronargdefaults,
      'argnames', p.proargnames, 'argmodes', p.proargmodes,
      'argtypes', (select coalesce(json_agg(format_type(x.t, null) order by x.ord), '[]') from unnest(p.proargtypes::oid[]) with ordinality x(t, ord)),
      'rettype', format_type(p.prorettype, null), 'retkind', t.typtype)), '[]')::text as body
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_type t on t.oid = p.prorettype
    where n.nspname = 'public' and p.prokind = 'f'`,
};

function loadCatalog(): Promise<Catalog> {
  return cached("rest.catalog", () => runAsSystem(async (tx) => {
    const read = async <T>(sql: string) => JSON.parse((await tx.query<{ body: string }>(sql)).rows[0].body) as T[];
    const relations = new Map<string, Relation>();
    for (const row of await read<{ rel: string; col: string }>(CATALOG_SQL.columns)) {
      if (!relations.has(row.rel)) relations.set(row.rel, { columns: new Set(), pk: [] });
      relations.get(row.rel)!.columns.add(row.col);
    }
    for (const row of await read<{ rel: string; cols: string[] }>(CATALOG_SQL.pks)) {
      const relation = relations.get(row.rel);
      if (relation) relation.pk = row.cols;
    }
    const fks = await read<ForeignKey>(CATALOG_SQL.fks);
    const functions = new Map<string, Fn[]>();
    type RawFn = { name: string; set: boolean; nargs: number; ndefaults: number; argnames: string[] | null; argmodes: string[] | null; argtypes: string[]; rettype: string; retkind: string };
    for (const raw of await read<RawFn>(CATALOG_SQL.functions)) {
      // proargnames covers IN, OUT and TABLE arguments in declaration order; the
      // input ones line up with proargtypes.
      const names = raw.argnames ?? [];
      const inputNames = raw.argmodes ? names.filter((_, index) => ["i", "b", "v"].includes(raw.argmodes![index])) : names;
      const hasOutput = Boolean(raw.argmodes?.some((mode) => mode === "o" || mode === "t" || mode === "b"));
      const args = raw.argtypes.map((type, index) => ({ name: inputNames[index] ?? "", type }));
      const returns: Fn["returns"] = raw.rettype === "void" ? "void" : hasOutput || raw.retkind === "c" || raw.rettype === "record" ? "row" : "scalar";
      const list = functions.get(raw.name) ?? [];
      list.push({ name: raw.name, args, required: raw.nargs - raw.ndefaults, set: raw.set, returns });
      functions.set(raw.name, list);
    }
    return { relations, fks, functions };
  }));
}

// ---------------------------------------------------------------------------
// Parsing: select lists, filters, logic trees
// ---------------------------------------------------------------------------
type ColumnItem = { kind: "column"; name: string; alias?: string; cast?: string };
type EmbedItem = { kind: "embed"; name: string; alias?: string; hints: string[]; inner: boolean; fields: Item[] };
type Item = ColumnItem | EmbedItem;

// Splits on top-level commas: commas inside parentheses or double quotes stay.
function splitTop(input: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let current = "";
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      current += char;
      if (char === "\\" && index + 1 < input.length) { current += input[index + 1]; index += 1; }
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === "(") depth += 1;
    else if (char === ")") depth = Math.max(0, depth - 1);
    if (char === "," && depth === 0) { parts.push(current); current = ""; }
    else current += char;
  }
  if (current !== "") parts.push(current);
  return parts;
}

function parseSelect(input: string): Item[] {
  return splitTop(input).map((part) => part.trim()).filter(Boolean).map((text): Item => {
    const open = text.indexOf("(");
    if (open !== -1 && text.endsWith(")")) {
      let head = text.slice(0, open);
      let alias: string | undefined;
      const colon = head.indexOf(":");
      if (colon !== -1) { alias = head.slice(0, colon).trim(); head = head.slice(colon + 1); }
      const [name, ...hints] = head.split("!").map((part) => part.trim());
      return { kind: "embed", name, alias, inner: hints.includes("inner"), hints: hints.filter((hint) => hint !== "inner" && hint !== "left"), fields: parseSelect(text.slice(open + 1, -1)) };
    }
    let rest = text;
    let cast: string | undefined;
    const castAt = rest.indexOf("::");
    if (castAt !== -1) { cast = rest.slice(castAt + 2).trim(); rest = rest.slice(0, castAt); }
    let alias: string | undefined;
    const colon = rest.indexOf(":");
    if (colon !== -1) { alias = rest.slice(0, colon).trim(); rest = rest.slice(colon + 1); }
    if (cast && !/^[a-z0-9_ ]+(\[\])?$/i.test(cast)) throw new SandboxError("PGRST100", "Unsupported cast in select", 400);
    return { kind: "column", name: rest.trim(), alias, cast };
  });
}

// "(a,b,"c,d")" → ["a", "b", "c,d"]
function parseList(input: string): string[] {
  const inner = input.trim().replace(/^\(/, "").replace(/\)$/, "");
  return splitTop(inner).map((part) => {
    const value = part.trim();
    return value.startsWith('"') && value.endsWith('"') && value.length >= 2 ? value.slice(1, -1).replace(/\\(.)/g, "$1") : value;
  });
}

const COMPARISONS: Record<string, string> = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=", match: "~", imatch: "~*", cs: "@>", cd: "<@", ov: "&&" };

function condition(alias: string, relation: Relation, column: string, expression: string): string {
  if (!relation.columns.has(column)) throw new SandboxError("42703", `column ${column} does not exist`, 400);
  let negate = false;
  let rest = expression;
  if (rest.startsWith("not.")) { negate = true; rest = rest.slice(4); }
  const dot = rest.indexOf(".");
  const op = dot === -1 ? rest : rest.slice(0, dot);
  const value = dot === -1 ? "" : rest.slice(dot + 1);
  const target = `${alias}.${ident(column)}`;
  let sql: string;
  if (COMPARISONS[op]) sql = `${target} ${COMPARISONS[op]} ${lit(value)}`;
  else if (op === "like" || op === "ilike") sql = `${target} ${op} ${lit(value.replace(/\*/g, "%"))}`;
  else if (op === "is") {
    const keyword = value.toLowerCase();
    if (!["null", "true", "false", "unknown"].includes(keyword)) throw new SandboxError("PGRST100", "Unsupported value for is", 400);
    sql = `${target} is ${keyword}`;
  } else if (op === "in") {
    const values = parseList(value);
    sql = values.length ? `${target} in (${values.map(lit).join(", ")})` : "false";
  } else if (op === "isdistinct") sql = `${target} is distinct from ${lit(value)}`;
  else throw new SandboxError("PGRST100", `Unsupported filter operator: ${op}`, 400);
  return negate ? `not (${sql})` : sql;
}

// or=(a.eq.1,b.ilike.*x*,and(c.gt.1,d.lt.5))
function logic(alias: string, relation: Relation, expression: string, joiner: "and" | "or"): string {
  const inner = expression.trim().replace(/^\(/, "").replace(/\)$/, "");
  const parts = splitTop(inner).map((part) => part.trim()).filter(Boolean).map((part) => {
    const nested = /^(not\.)?(and|or)\(([\s\S]*)\)$/.exec(part);
    if (nested) {
      const sql = logic(alias, relation, `(${nested[3]})`, nested[2] as "and" | "or");
      return nested[1] ? `not ${sql}` : sql;
    }
    const dot = part.indexOf(".");
    if (dot === -1) throw new SandboxError("PGRST100", "Malformed filter", 400);
    return condition(alias, relation, part.slice(0, dot), part.slice(dot + 1));
  });
  return parts.length ? `(${parts.join(joiner === "or" ? " or " : " and ")})` : "true";
}

function orderBy(alias: string, relation: Relation, spec: string): string {
  return splitTop(spec).map((part) => {
    const [column, ...modifiers] = part.trim().split(".");
    if (!relation.columns.has(column)) throw new SandboxError("42703", `column ${column} does not exist`, 400);
    let sql = `${alias}.${ident(column)}${modifiers.includes("desc") ? " desc" : " asc"}`;
    if (modifiers.includes("nullsfirst")) sql += " nulls first";
    if (modifiers.includes("nullslast")) sql += " nulls last";
    return sql;
  }).join(", ");
}

// Query-string filters grouped by the embedded resource they apply to ("" = top level).
type Scope = { filters: [string, string][]; logic: ["and" | "or", string, boolean][]; order?: string; limit?: number; offset?: number };
type Query = { select: string | null; scopes: Map<string, Scope>; onConflict: string | null; columns: string | null; args: [string, string][] };
const RESERVED = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"]);

function parseQuery(url: URL): Query {
  const scopes = new Map<string, Scope>();
  const scope = (path: string) => {
    if (!scopes.has(path)) scopes.set(path, { filters: [], logic: [] });
    return scopes.get(path)!;
  };
  const query: Query = { select: null, scopes, onConflict: null, columns: null, args: [] };
  const count = (value: string) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 0) throw new SandboxError("PGRST103", "Invalid range", 416);
    return parsed;
  };
  for (const [key, value] of url.searchParams.entries()) {
    query.args.push([key, value]);
    if (key === "select") { query.select = value; continue; }
    if (key === "on_conflict") { query.onConflict = value; continue; }
    if (key === "columns") { query.columns = value; continue; }
    const segments = key.split(".");
    const last = segments.pop()!;
    let path = segments.join(".");
    let negated = false;
    if (path === "not" || path.endsWith(".not")) { negated = true; path = path.replace(/\.?not$/, ""); }
    const target = scope(path);
    if (last === "order") target.order = value;
    else if (last === "limit") target.limit = count(value);
    else if (last === "offset") target.offset = count(value);
    else if (last === "and" || last === "or") target.logic.push([last, value, negated]);
    else if (negated) throw new SandboxError("PGRST100", "Malformed filter", 400);
    else target.filters.push([last, value]);
  }
  return query;
}

// ---------------------------------------------------------------------------
// SQL generation
// ---------------------------------------------------------------------------
type Built = { projection: string[]; joins: string[]; conditions: string[]; needed: Set<string> };
type BuildContext = { catalog: Catalog; query: Query; next: { value: number } };

function relationOf(catalog: Catalog, name: string): Relation {
  const relation = catalog.relations.get(name);
  if (!relation) throw new SandboxError("PGRST205", `Could not find the table 'public.${name}' in the schema cache`, 404);
  return relation;
}

type Link = { kind: "one" | "many"; target: string; pairs: [parent: string, child: string][] };

function resolveLink(catalog: Catalog, relation: string, item: EmbedItem): Link {
  const zip = (parent: string[], child: string[]) => parent.map((column, index): [string, string] => [column, child[index]]);
  const hinted = (fk: ForeignKey) => !item.hints.length || item.hints.some((hint) => hint === fk.name || fk.columns.includes(hint));
  // alias:fk_column(...) — the name is this table's foreign-key column.
  if (!catalog.relations.has(item.name)) {
    const viaColumn = catalog.fks.find((fk) => fk.table === relation && fk.columns.length === 1 && fk.columns[0] === item.name);
    if (viaColumn) return { kind: "one", target: viaColumn.ref, pairs: zip(viaColumn.columns, viaColumn.refColumns) };
  }
  const toOne = catalog.fks.filter((fk) => fk.table === relation && fk.ref === item.name && hinted(fk));
  if (toOne.length) return { kind: "one", target: item.name, pairs: zip(toOne[0].columns, toOne[0].refColumns) };
  const toMany = catalog.fks.filter((fk) => fk.table === item.name && fk.ref === relation && hinted(fk));
  if (toMany.length) return { kind: toMany[0].unique ? "one" : "many", target: item.name, pairs: zip(toMany[0].refColumns, toMany[0].columns) };
  throw new SandboxError("PGRST200", `Could not find a relationship between '${relation}' and '${item.name}' in the schema cache`, 400);
}

function scopeConditions(context: BuildContext, path: string, alias: string, relation: Relation): string[] {
  const scope = context.query.scopes.get(path);
  if (!scope) return [];
  return [
    ...scope.filters.map(([column, expression]) => condition(alias, relation, column, expression)),
    ...scope.logic.map(([joiner, expression, negated]) => `${negated ? "not " : ""}${logic(alias, relation, expression, joiner)}`),
  ];
}

function buildItems(context: BuildContext, relationName: string, alias: string, items: Item[], path: string): Built {
  const relation = relationOf(context.catalog, relationName);
  const built: Built = { projection: [], joins: [], conditions: [], needed: new Set() };
  for (const item of items) {
    if (item.kind === "column") {
      if (item.name === "*") { built.projection.push(`${alias}.*`); built.needed.add("*"); continue; }
      // PostgREST aggregate: relation(count) → [{ "count": n }]
      if (item.name === "count" && !relation.columns.has("count")) { built.projection.push(`count(*) as ${ident(item.alias ?? "count")}`); continue; }
      if (!relation.columns.has(item.name)) throw new SandboxError("42703", `column ${relationName}.${item.name} does not exist`, 400);
      built.projection.push(`${alias}.${ident(item.name)}${item.cast ? `::${item.cast}` : ""} as ${ident(item.alias ?? item.name)}`);
      built.needed.add(item.name);
      continue;
    }
    const link = resolveLink(context.catalog, relationName, item);
    const number = (context.next.value += 1);
    const childAlias = `t${number}`;
    const joinAlias = `e${number}`;
    const key = item.alias ?? item.name;
    const childPath = path ? `${path}.${key}` : key;
    const child = buildItems(context, link.target, childAlias, item.fields, childPath);
    const childRelation = relationOf(context.catalog, link.target);
    const where = [
      ...link.pairs.map(([parent, column]) => `${childAlias}.${ident(column)} = ${alias}.${ident(parent)}`),
      ...child.conditions,
      ...scopeConditions(context, childPath, childAlias, childRelation),
      // Filters may name the relation rather than its alias.
      ...(key !== item.name ? scopeConditions(context, path ? `${path}.${item.name}` : item.name, childAlias, childRelation) : []),
    ];
    for (const [parent] of link.pairs) built.needed.add(parent);
    const scope = context.query.scopes.get(childPath);
    const order = scope?.order ? ` order by ${orderBy(childAlias, childRelation, scope.order)}` : "";
    const limit = link.kind === "one" ? " limit 1" : scope?.limit !== undefined ? ` limit ${scope.limit}` : "";
    const rows = `select ${child.projection.join(", ") || "null"} from public.${ident(link.target)} as ${childAlias} ${child.joins.join(" ")} where ${where.join(" and ")}${order}${limit}`;
    if (link.kind === "one") {
      built.joins.push(`left join lateral (select row_to_json(_s) as j from (${rows}) _s) ${joinAlias} on true`);
      if (item.inner) built.conditions.push(`${joinAlias}.j is not null`);
    } else {
      built.joins.push(`left join lateral (select coalesce(json_agg(row_to_json(_s)), '[]'::json) as j, count(*) as n from (${rows}) _s) ${joinAlias} on true`);
      if (item.inner) built.conditions.push(`${joinAlias}.n > 0`);
    }
    built.projection.push(`${joinAlias}.j as ${ident(key)}`);
  }
  return built;
}

const AGG = "select coalesce(json_agg(row_to_json(_r)), '[]'::json)::text as body from";

function preferences(headers: Headers) {
  const prefer = (headers.get("prefer") ?? "").toLowerCase();
  return {
    representation: prefer.includes("return=representation"),
    count: /count=(exact|planned|estimated)/.test(prefer),
    merge: prefer.includes("resolution=merge-duplicates"),
    ignore: prefer.includes("resolution=ignore-duplicates"),
  };
}

const wantsObject = (headers: Headers) => (headers.get("accept") ?? "").includes("application/vnd.pgrst.object+json");

function reply(body: string | null, status: number, headers: Record<string, string> = {}) {
  return new Response(body, { status, headers: { ...(body === null ? {} : { "content-type": "application/json; charset=utf-8" }), ...headers } });
}

// Applies .single(): exactly one row, or PostgREST's PGRST116.
function shape(rowsJson: string, request: SandboxRequest, status: number, headers: Record<string, string> = {}) {
  if (!wantsObject(request.headers)) return reply(request.method === "HEAD" ? null : rowsJson, status, headers);
  const rows = JSON.parse(rowsJson) as unknown[];
  if (rows.length !== 1) {
    throw new SandboxError("PGRST116", "JSON object requested, multiple (or no) rows returned", 406, `The result contains ${rows.length} rows`);
  }
  return reply(request.method === "HEAD" ? null : JSON.stringify(rows[0]), status, headers);
}

function parseBody(request: SandboxRequest): unknown {
  if (!request.body || request.body.byteLength === 0) return null;
  try {
    return JSON.parse(Buffer.from(request.body).toString("utf8"));
  } catch {
    throw new SandboxError("PGRST102", "Empty or invalid json", 400);
  }
}

async function read(request: SandboxRequest, caller: Caller, table: string): Promise<Response> {
  const catalog = await loadCatalog();
  const query = parseQuery(request.url);
  const relation = relationOf(catalog, table);
  const context: BuildContext = { catalog, query, next: { value: 0 } };
  const built = buildItems(context, table, "t0", parseSelect(query.select ?? "*"), "");
  const conditions = [...scopeConditions(context, "", "t0", relation), ...built.conditions];
  const from = `from public.${ident(table)} as t0 ${built.joins.join(" ")}${conditions.length ? ` where ${conditions.join(" and ")}` : ""}`;
  const root = query.scopes.get("");
  const order = root?.order ? ` order by ${orderBy("t0", relation, root.order)}` : "";
  const limit = root?.limit !== undefined ? ` limit ${root.limit}` : "";
  const offset = root?.offset ? ` offset ${root.offset}` : "";
  const prefer = preferences(request.headers);
  const head = request.method === "HEAD";

  return runAs(caller, async (tx) => {
    const body = head && !wantsObject(request.headers)
      ? "[]"
      : (await tx.query<{ body: string }>(`${AGG} (select ${built.projection.join(", ")} ${from}${order}${limit}${offset}) _r`)).rows[0].body;
    const headers: Record<string, string> = {};
    if (prefer.count) {
      const total = (await tx.query<{ n: number }>(`select count(*)::int as n ${from}`)).rows[0].n;
      const start = root?.offset ?? 0;
      const returned = head ? Math.max(0, Math.min(root?.limit ?? total, total - start)) : (JSON.parse(body) as unknown[]).length;
      headers["content-range"] = `${returned ? `${start}-${start + returned - 1}` : "*"}/${total}`;
    }
    return shape(body, request, 200, headers);
  });
}

function returning(context: BuildContext, table: string, select: string | null) {
  const built = buildItems(context, table, "t0", parseSelect(select ?? "*"), "");
  const columns = built.needed.has("*") ? "*" : [...built.needed].map(ident).join(", ") || "*";
  const tail = `${AGG} (select ${built.projection.join(", ")} from _w as t0 ${built.joins.join(" ")}) _r`;
  return { columns, tail };
}

async function write(request: SandboxRequest, caller: Caller, table: string): Promise<Response> {
  const catalog = await loadCatalog();
  const query = parseQuery(request.url);
  const relation = relationOf(catalog, table);
  const context: BuildContext = { catalog, query, next: { value: 0 } };
  const prefer = preferences(request.headers);
  const target = `public.${ident(table)}`;
  const payload = request.method === "DELETE" ? null : parseBody(request);
  let statement: string;
  let qualifier = "";

  if (request.method === "POST") {
    const rows = Array.isArray(payload) ? payload : payload ? [payload] : [];
    if (!rows.length) return prefer.representation ? shape("[]", request, 201) : reply(null, 201);
    const columns = query.columns
      ? parseList(query.columns)
      : Object.keys(rows[0] as Record<string, unknown>);
    for (const column of columns) if (!relation.columns.has(column)) throw new SandboxError("PGRST204", `Could not find the '${column}' column of '${table}' in the schema cache`, 400);
    const list = columns.map(ident).join(", ");
    const source = columns.length
      ? `(${list}) select ${list} from json_populate_recordset(null::${target}, ${lit(JSON.stringify(rows))}::json)`
      : "default values";
    let conflict = "";
    if (prefer.merge || prefer.ignore) {
      const keys = (query.onConflict ? parseList(query.onConflict) : relation.pk).map(ident).join(", ");
      const updates = columns.map((column) => `${ident(column)} = excluded.${ident(column)}`).join(", ");
      conflict = prefer.ignore || !updates ? ` on conflict${keys ? ` (${keys})` : ""} do nothing` : ` on conflict (${keys}) do update set ${updates}`;
    }
    statement = `insert into ${target} ${source}${conflict}`;
  } else {
    const conditions = scopeConditions(context, "", "t0", relation);
    const where = conditions.length ? ` where ${conditions.join(" and ")}` : "";
    qualifier = "t0.";
    if (request.method === "DELETE") {
      statement = `delete from ${target} as t0${where}`;
    } else {
      const body = (payload ?? {}) as Record<string, unknown>;
      const columns = Object.keys(body);
      if (!columns.length) return prefer.representation ? shape("[]", request, 200) : reply(null, 204);
      for (const column of columns) if (!relation.columns.has(column)) throw new SandboxError("PGRST204", `Could not find the '${column}' column of '${table}' in the schema cache`, 400);
      const assignments = columns.map((column) => `${ident(column)} = _j.${ident(column)}`).join(", ");
      statement = `update ${target} as t0 set ${assignments} from json_populate_record(null::${target}, ${lit(JSON.stringify(body))}::json) as _j${where}`;
    }
  }

  const created = request.method === "POST";
  return runAs(caller, async (tx) => {
    if (!prefer.representation) {
      await tx.query(statement);
      return reply(null, created ? 201 : 204);
    }
    const { columns, tail } = returning(context, table, query.select);
    const list = columns === "*" ? `${qualifier}*` : columns.split(", ").map((column) => `${qualifier}${column}`).join(", ");
    const body = (await tx.query<{ body: string }>(`with _w as (${statement} returning ${list}) ${tail}`)).rows[0].body;
    return shape(body, request, created ? 201 : 200);
  });
}

// A JavaScript argument as a literal Postgres can cast to the declared type.
function argument(value: unknown, type: string): string {
  if (value === null || value === undefined) return `null::${type}`;
  const element = (item: unknown): string => {
    if (item === null || item === undefined) return "NULL";
    if (Array.isArray(item)) return `{${item.map(element).join(",")}}`;
    const text = typeof item === "object" ? JSON.stringify(item) : String(item);
    return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  };
  if (type.endsWith("[]") && Array.isArray(value)) return `${lit(`{${value.map(element).join(",")}}`)}::${type}`;
  return `${lit(value)}::${type}`;
}

async function rpc(request: SandboxRequest, caller: Caller, name: string): Promise<Response> {
  const catalog = await loadCatalog();
  const candidates = catalog.functions.get(name) ?? [];
  const query = parseQuery(request.url);
  const supplied: Record<string, unknown> = request.method === "POST"
    ? ((parseBody(request) ?? {}) as Record<string, unknown>)
    : Object.fromEntries(query.args.filter(([key]) => !RESERVED.has(key)));
  const names = Object.keys(supplied);
  const fn = candidates.find((candidate) => {
    const known = candidate.args.map((arg) => arg.name);
    return names.every((arg) => known.includes(arg)) && candidate.args.slice(0, candidate.required).every((arg) => names.includes(arg.name));
  });
  if (!fn) {
    throw new SandboxError("PGRST202", `Could not find the function public.${name}${names.length ? `(${names.join(", ")})` : ""} in the schema cache`, 404);
  }
  const call = `public.${ident(name)}(${fn.args.filter((arg) => names.includes(arg.name)).map((arg) => `${ident(arg.name)} := ${argument(supplied[arg.name], arg.type)}`).join(", ")})`;

  return runAs(caller, async (tx) => {
    if (fn.set) {
      const sql = fn.returns === "row"
        ? `${AGG} (select * from ${call}) _r`
        : `select coalesce(json_agg(_f), '[]'::json)::text as body from ${call} as _f`;
      return shape((await tx.query<{ body: string }>(sql)).rows[0].body, request, 200);
    }
    if (fn.returns === "void") {
      await tx.query(`select ${call}`);
      return reply(null, 204);
    }
    const sql = fn.returns === "row"
      ? `select row_to_json(_r)::text as body from (select * from ${call}) _r`
      : `select to_json(${call})::text as body`;
    const body = (await tx.query<{ body: string | null }>(sql)).rows[0]?.body ?? "null";
    return reply(request.method === "HEAD" ? null : body, 200);
  });
}

export async function handleRest(request: SandboxRequest, caller: Caller, path: string): Promise<Response> {
  const name = decodeURIComponent(path.replace(/^\/+|\/+$/g, ""));
  if (!name) return reply("{}", 200);
  if (name.startsWith("rpc/")) return rpc(request, caller, name.slice(4));
  if (request.method === "GET" || request.method === "HEAD") return read(request, caller, name);
  if (request.method === "POST" || request.method === "PATCH" || request.method === "DELETE") return write(request, caller, name);
  throw new SandboxError("PGRST117", "Unsupported HTTP method", 405);
}
