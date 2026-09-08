import type { Context } from 'hono';
import type { z } from 'zod';

/** Valide le corps JSON d'une requête ; les erreurs Zod sont formatées par errorHandler. */
export async function parseBody<T extends z.ZodTypeAny>(c: Context, schema: T): Promise<z.infer<T>> {
  const body = await c.req.json().catch(() => ({}));
  return schema.parse(body);
}

/**
 * Valide la chaîne de requête. Les paramètres répétés (`?kinds=manga&kinds=anime`)
 * sont regroupés en tableau, les booléens et nombres restant convertis par le
 * schéma lui-même.
 */
export function parseQuery<T extends z.ZodTypeAny>(
  c: Context,
  schema: T,
  arrayKeys: string[] = [],
): z.infer<T> {
  const raw: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(c.req.query())) {
    raw[key] = value;
  }
  for (const key of arrayKeys) {
    const values = c.req.queries(key);
    if (values?.length) raw[key] = values.length === 1 ? values[0]!.split(',') : values;
    else delete raw[key];
  }
  for (const [key, value] of Object.entries(raw)) {
    if (value === 'true') raw[key] = true;
    else if (value === 'false') raw[key] = false;
  }

  return schema.parse(raw);
}
