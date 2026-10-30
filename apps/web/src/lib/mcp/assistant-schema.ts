/**
 * Tool schemas for clients that accept only a small subset of JSON Schema in tool definitions (Gemini function declarations). The tools
 * themselves are not changed: this only rewrites what a client is shown, and the server still validates every argument itself.
 * Rewritten: `additionalProperties`, `$schema`, `format`, `pattern`, `default`, `uniqueItems`, `const` and `anyOf` are removed or turned into
 * `enum` and the first branch (the other branches are named in the description), and `type` lists become one type. Plain types, enums, items,
 * properties, required, descriptions, minimum, maximum, minItems and maxItems stay.
 */
type Schema = Record<string, unknown>;
const DROP = new Set(["additionalProperties", "$schema", "format", "pattern", "default", "uniqueItems", "examples", "title"]);

const asSchema = (v: unknown): Schema | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Schema) : null);
const note = (s: Schema, extra: string) => ({ ...s, description: [s.description, extra].filter(Boolean).join(" ") });

export function simplifySchema(input: unknown): Schema {
  const s = asSchema(input);
  if (!s) return {};
  let out: Schema = {};
  const alternatives = Array.isArray(s.anyOf) ? s.anyOf : Array.isArray(s.oneOf) ? s.oneOf : null;
  if (alternatives && alternatives.length > 0) {
    const branches = alternatives.map(asSchema).filter((b): b is Schema => Boolean(b));
    const first = branches.find((b) => !("const" in b)) ?? branches[0]!;
    const others = branches.filter((b) => b !== first).map((b) => ("const" in b ? JSON.stringify(b.const) : JSON.stringify(simplifySchema(b))));
    out = simplifySchema(first);
    if (s.description) out.description = String(s.description);
    if (others.length > 0) out = note(out, `Also accepted: ${others.join(" or ")}.`);
    return out;
  }
  for (const [k, v] of Object.entries(s)) {
    if (DROP.has(k) || k === "anyOf" || k === "oneOf") continue;
    if (k === "const") {
      out.enum = [v];
      if (!out.type) out.type = typeof v === "number" ? "number" : typeof v === "boolean" ? "boolean" : "string";
    } else if (k === "type" && Array.isArray(v)) {
      out.type = v.find((t) => t !== "null") ?? "string";
    } else if (k === "properties") {
      out.properties = Object.fromEntries(Object.entries(v as Schema).map(([name, sub]) => [name, simplifySchema(sub)]));
    } else if (k === "items") {
      out.items = simplifySchema(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}
