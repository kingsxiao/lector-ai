import { t, type LocalePref, type StringKey } from '../../shared/i18n'
import { newSiteRuleId, siteToggleState, type SiteRule } from '../../shared/siteRules'

// Extracted from SettingsView.tsx so SettingsView can be lazy-loaded: this chip
// lives in the always-visible header, so it must stay eagerly loaded.
//
// A header chip that cycles the active-tab host's translation rule:
// auto → always → never → auto. Writes a SiteRule (or removes it) via the
// parent's onToggle, which persists the whole siteRules list.
export function CurrentSiteChip({
  host,
  rules,
  locale,
  onToggle,
}: {
  host: string
  rules: SiteRule[]
  locale: LocalePref
  onToggle: (next: SiteRule[]) => void
}) {
  const state = siteToggleState(rules, host)
  // Cycle auto → always → never → auto.
  const cycle = () => {
    const filtered = rules.filter((r) => r.hostPattern !== host)
    if (state === 'auto') {
      onToggle([{ id: newSiteRuleId(), hostPattern: host, mode: 'always', createdAt: Date.now() }, ...filtered])
    } else if (state === 'always') {
      onToggle([{ id: newSiteRuleId(), hostPattern: host, mode: 'never', createdAt: Date.now() }, ...filtered])
    } else {
      onToggle(filtered) // never → auto (remove rule)
    }
  }
  const label = t(`settings.translation.siteState.${state}` as StringKey, locale)
  const tone =
    state === 'always' ? 'text-accent' : state === 'never' ? 'text-danger' : 'text-ink-faint'
  return (
    <button
      type="button"
      onClick={cycle}
      title={t('settings.translation.siteState.cycle', locale)}
      className={`mt-1 inline-flex items-center gap-1 text-[10px] ${tone} hover:underline`}
    >
      <span className="truncate max-w-[160px]">{label}</span>
    </button>
  )
}
