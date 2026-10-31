import { z } from 'zod';

type JsonSchema = Record<string, unknown> & { type?: string; properties?: Record<string, JsonSchema>; required?: string[] };

/** The account route's strict tools require every property, using null for optional fields. */
function strictSchema(schema: JsonSchema): JsonSchema {
  const result: JsonSchema = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === '$schema' || key === 'default' || key === 'properties' || key === 'prefixItems' || key === 'discriminator') continue;
    // The strict account route accepts anyOf, but rejects Zod's oneOf output.
    // Discriminant constants keep these action branches mutually exclusive.
    result[key === 'oneOf' ? 'anyOf' : key] = Array.isArray(value) ? value.map(item => item && typeof item === 'object' ? strictSchema(item as JsonSchema) : item)
      : value && typeof value === 'object' ? strictSchema(value as JsonSchema) : value;
  }
  if (Array.isArray(schema.prefixItems)) {
    const items = (schema.prefixItems as JsonSchema[]).map(item => strictSchema(item));
    const unique = [...new Map(items.map(item => [JSON.stringify(item), item])).values()];
    // Coordinate tuples are homogeneous. Keep their exact length while using
    // the route's supported array form; local Zod validation remains canonical.
    result.items = unique.length === 1 ? unique[0] : { anyOf: unique };
  }
  if (schema.type === 'object' && schema.properties) {
    result.properties = Object.fromEntries(Object.entries(schema.properties).map(([key, value]) => {
      const normalized = strictSchema(value);
      return [key, schema.required?.includes(key) ? normalized : { anyOf: [normalized, { type: 'null' }] }];
    }));
    result.required = Object.keys(schema.properties); result.additionalProperties = false;
  }
  return result;
}

export function toolParameters(schema: z.ZodType): Record<string, unknown> {
  return strictSchema(z.toJSONSchema(schema, { unrepresentable: 'any', io: 'input' }) as JsonSchema);
}

export function parseToolInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const inputSchema = z.toJSONSchema(schema, { unrepresentable: 'any', io: 'input' }) as JsonSchema;
  const normalize = (item: unknown, shape: JsonSchema, depth = 0): unknown => {
    if (depth > 32) throw new Error('Tool output is too complex.');
    if (Array.isArray(item)) return item.map(child => normalize(child, (shape.items ?? {}) as JsonSchema, depth + 1));
    if (!item || typeof item !== 'object') return item;
    const result: Record<string, unknown> = Object.create(null);
    for (const [key, child] of Object.entries(item)) {
      const property = shape.properties?.[key];
      if (child === null && property && !shape.required?.includes(key)) continue;
      result[key] = normalize(child, property ?? {}, depth + 1);
    }
    return result;
  };
  return schema.parse(normalize(value, inputSchema));
}
