/**
 * OpenAI structured output (which Codex uses for an output schema) is strict:
 * every object lists all its properties as required and allows no others.
 * Optional fields become "this type or null"; nullsToUndefined undoes that
 * on the way back so the zod schema that made the JSON schema still parses it.
 */
export function strictJsonSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(strictJsonSchema);
  if (!schema || typeof schema !== "object") return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema)) out[k] = k === "properties" ? v : strictJsonSchema(v);
  const props = (schema as { properties?: Record<string, unknown> }).properties;
  if (props) {
    const required = new Set((schema as { required?: string[] }).required ?? []);
    out.properties = Object.fromEntries(
      Object.entries(props).map(([k, v]) => {
        const strict = strictJsonSchema(v);
        return [k, required.has(k) ? strict : { anyOf: [strict, { type: "null" }] }];
      }),
    );
    out.required = Object.keys(props);
    out.additionalProperties = false;
  }
  return out;
}

export function nullsToUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(nullsToUndefined);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null).map(([k, v]) => [k, nullsToUndefined(v)]));
}
