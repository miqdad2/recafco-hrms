/**
 * Correctly parses a "true"/"false" query-string value into a real boolean.
 *
 * `class-transformer`'s `@Type(() => Boolean)` is unsafe for this: it calls the `Boolean()`
 * constructor on the raw string, and `Boolean("false")` evaluates to `true` in JavaScript
 * (any non-empty string is truthy) — silently breaking every `?flag=false` query filter
 * while `@IsBoolean()` still validates it as "true", masking the bug entirely.
 */
export function parseQueryBoolean(value: unknown): unknown {
  if (typeof value === 'boolean') {
    return value;
  }
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  return value;
}
