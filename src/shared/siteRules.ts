// Per-domain translation rules.
//
// Pure module: no DOM, no chrome. Lets the user say "always translate this
// site", "never translate this site", or scope custom CSS selectors / a
// specific engine to a site. The content script consults the matcher on load
// to decide whether to auto-run bilingual and how to gather blocks.
//
// Host matching is wildcard-aware: `*.example.com` matches `www.example.com`
// and `a.b.example.com`; a bare `example.com` matches that exact host and any
// subdomain (so users don't have to add a rule per subdomain).

export type SiteRuleMode = 'always' | 'never' | 'customEngine'

export interface SiteRule {
  id: string
  /** Host pattern, e.g. `example.com` or `*.example.com`. */
  hostPattern: string
  mode: SiteRuleMode
  /** When mode === 'customEngine', the provider/engine id to bind to this site. */
  engine?: string
  /** Extra CSS selectors to INCLUDE in translation (added to the defaults). */
  selectors?: string[]
  /** Extra CSS selectors to EXCLUDE from translation. */
  excludeSelectors?: string[]
  createdAt: number
}

/** Validate the mode union; reject anything else. */
export function isValidSiteRuleMode(m: unknown): m is SiteRuleMode {
  return m === 'always' || m === 'never' || m === 'customEngine'
}

export function newSiteRuleId(): string {
  return 'sr_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

/**
 * Match a host against a pattern.
 *   - `*.example.com` matches any subdomain (one or more labels) of example.com.
 *   - `example.com` matches `example.com` AND any `*.example.com` (lenient, so
 *     users don't add one rule per subdomain).
 *   - Case-insensitive; leading dots trimmed.
 *
 * Empty pattern / empty host never match.
 */
export function matchHost(pattern: string, host: string): boolean {
  const p = pattern.trim().toLowerCase().replace(/^\./, '')
  const h = host.trim().toLowerCase()
  if (!p || !h) return false
  if (p.startsWith('*.')) {
    const base = p.slice(2) // "example.com"
    return h === base || h.endsWith('.' + base)
  }
  // Bare host: exact OR subdomain match (lenient).
  return h === p || h.endsWith('.' + p)
}

/**
 * Find the FIRST rule (in list order) whose pattern matches the host. List
 * order is the user's declared priority; first match wins so a user can put a
 * specific `never` above a broader `always`.
 */
export function findRuleForHost(rules: SiteRule[], host: string): SiteRule | undefined {
  return rules.find((r) => matchHost(r.hostPattern, host))
}

/** Normalize arbitrary stored data into a clean SiteRule[] (migration-safe). */
export function normalizeSiteRules(raw: unknown): SiteRule[] {
  if (!Array.isArray(raw)) return []
  const out: SiteRule[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    const hostPattern = typeof r.hostPattern === 'string' ? r.hostPattern.trim() : ''
    if (!hostPattern) continue
    if (!isValidSiteRuleMode(r.mode)) continue
    const rule: SiteRule = {
      id: typeof r.id === 'string' && r.id ? r.id : newSiteRuleId(),
      hostPattern,
      mode: r.mode,
      createdAt: typeof r.createdAt === 'number' ? r.createdAt : Date.now(),
    }
    if (typeof r.engine === 'string' && r.engine) rule.engine = r.engine
    if (Array.isArray(r.selectors)) {
      const sels = r.selectors.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
      if (sels.length) rule.selectors = sels
    }
    if (Array.isArray(r.excludeSelectors)) {
      const sels = r.excludeSelectors.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
      if (sels.length) rule.excludeSelectors = sels
    }
    out.push(rule)
  }
  return out
}

/**
 * Build a quick-toggle summary for the current host: 'always' | 'never' | 'auto'
 * (auto = no explicit rule). The side-panel chip cycles through these three.
 */
export function siteToggleState(rules: SiteRule[], host: string): 'always' | 'never' | 'auto' {
  const r = findRuleForHost(rules, host)
  if (r?.mode === 'always') return 'always'
  if (r?.mode === 'never') return 'never'
  return 'auto'
}
