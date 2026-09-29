import manifest from "../../theme.json"

import { api } from "@/lib/api"

/**
 * The operator's settings, laid over the defaults this theme declares in
 * `theme.json`. The hub stores only what the site owner changed away from a
 * default, so a default the theme changes later reaches every site that never
 * touched that field.
 *
 * A saved value of another type -- left by an older version of this theme --
 * counts as unsaved. Any failure renders the defaults rather than an error, and
 * that includes a hub predating settings, which answers 404.
 */
export function loadConfig(): Promise<Record<string, unknown>> {
  // The type is checked; a `select` or a ranged `number` would also want the
  // option and min/max checks the panel applies to the same values. `title`
  // entries are headings and carry no key, so they hold nothing to fill in.
  const declared = (manifest.config as { key?: string; default?: unknown }[]).filter(
    (field): field is { key: string; default?: unknown } => typeof field.key === "string",
  )
  const pick = (saved: Record<string, unknown>) =>
    Object.fromEntries(
      declared.map((field) => [
        field.key,
        typeof saved[field.key] === typeof field.default ? saved[field.key] : field.default,
      ]),
    )
  return api<Record<string, unknown>>(`/themes/${manifest.short}/config`)
    .then(pick)
    .catch(() => pick({}))
}
