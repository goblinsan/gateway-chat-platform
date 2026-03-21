/**
 * The canonical set of provider names recognised by this API.
 * Used for input validation in routes to prevent unknown values.
 */
export const KNOWN_PROVIDER_NAMES = [
  'lm-studio-a',
  'lm-studio-b',
  'openai',
  'anthropic',
  'google',
] as const

export type KnownProviderName = (typeof KNOWN_PROVIDER_NAMES)[number]

export const KNOWN_PROVIDER_NAME_SET = new Set<string>(KNOWN_PROVIDER_NAMES)
