/**
 * Validation helpers shared by the public and server environment surfaces.
 * Pure — safe to import from anywhere.
 */

export class MissingEnvError extends Error {
  constructor(names: string[]) {
    super(
      names.length === 1
        ? `Missing required environment variable: ${names[0]}`
        : `Missing required environment variables: ${names.join(", ")}`,
    );
    this.name = "MissingEnvError";
  }
}

type Source = Record<string, string | undefined>;

/**
 * Read every named variable, collecting the absent ones so a single throw
 * names all of them rather than one per run.
 */
export function requireAll<const K extends readonly string[]>(
  source: Source,
  names: K,
): Record<K[number], string> {
  const out = {} as Record<K[number], string>;
  const missing: string[] = [];

  for (const name of names) {
    const value = source[name];
    if (value === undefined || value === "") {
      missing.push(name);
      continue;
    }
    out[name as K[number]] = value;
  }

  if (missing.length > 0) throw new MissingEnvError(missing);
  return out;
}

/** Read an optional variable, falling back when absent or empty. */
export function optional(
  source: Source,
  name: string,
  fallback?: string,
): string | undefined {
  const value = source[name];
  return value === undefined || value === "" ? fallback : value;
}

/** Read a variable that must parse as a positive integer. */
export function requireInt(source: Source, name: string): number {
  const [raw] = Object.values(requireAll(source, [name] as const));
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(
      `Environment variable ${name} must be a positive integer, got: ${raw}`,
    );
  }
  return parsed;
}
