import { useState, memo } from 'react'
import { validateEntry, exportGlossary, importGlossary, type GlossaryEntry } from '../../shared/glossary'
import type { StringKey } from '../../shared/i18n'
import { PlusIcon, DownloadIcon, UploadIcon, PencilIcon, TrashIcon } from '../../shared/icons'
import { ViewShell, Empty } from '../components/leaf'
import { downloadBlob, readJsonFile } from '../lib/downloads'

interface GlossaryViewProps {
  entries: GlossaryEntry[]
  tr: (key: StringKey) => string
  onAdd: (e: { source: string; target: string; note?: string; enabled: boolean }) => void
  onUpdate: (id: string, patch: Partial<GlossaryEntry>) => void
  onRemove: (id: string) => void
  onImport: (entries: GlossaryEntry[]) => void
}

function GlossaryViewImpl({
  entries,
  tr,
  onAdd,
  onUpdate,
  onRemove,
  onImport,
}: GlossaryViewProps) {
  const [editing, setEditing] = useState<{
    id: string | null
    source: string
    target: string
    note: string
  } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)

  const startNew = () => {
    setEditing({ id: null, source: '', target: '', note: '' })
    setErr(null)
  }
  const startEdit = (e: GlossaryEntry) => {
    setEditing({ id: e.id, source: e.source, target: e.target, note: e.note || '' })
    setErr(null)
  }

  const save = () => {
    if (!editing) return
    const v = validateEntry({ source: editing.source, target: editing.target })
    if (!v.ok) {
      setErr(
        v.reason === 'empty-source'
          ? tr('side.glossary.errSource')
          : v.reason === 'empty-target'
            ? tr('side.glossary.errTarget')
            : (v.reason ?? '')
      )
      return
    }
    if (editing.id) {
      onUpdate(editing.id, {
        source: editing.source,
        target: editing.target,
        note: editing.note || undefined,
      })
    } else {
      onAdd({
        source: editing.source,
        target: editing.target,
        note: editing.note || undefined,
        enabled: true,
      })
    }
    setEditing(null)
  }

  const handleExport = () => {
    downloadBlob(
      `lector-glossary-${new Date().toISOString().slice(0, 10)}.json`,
      exportGlossary(entries),
      'application/json'
    )
  }

  const handleImport = async (file: File) => {
    const res = await readJsonFile(file, importGlossary)
    if (!res.ok || !res.entries) {
      setFlash(tr('side.importFail').replace('{msg}', res.reason || ''))
      return
    }
    // A valid top-level array whose rows ALL fail validation parses to ok with
    // zero entries (e.g. an array of plain strings). Importing that would
    // replace the user's existing glossary with an empty list — treat it as a
    // failed import instead.
    if (res.entries.length === 0) {
      setFlash(tr('side.importFail').replace('{msg}', '0'))
      return
    }
    onImport(res.entries)
    setFlash(tr('side.glossary.importOk').replace('{n}', String(res.entries.length)))
  }

  return (
    <ViewShell title={tr('side.glossary.title')}>
      {editing ? (
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3.5">
          <div>
            <label htmlFor="lector-glos-source" className="label mb-1.5">
              {tr('side.glossary.sourceField')}
            </label>
            <input
              id="lector-glos-source"
              value={editing.source}
              onChange={(e) => setEditing({ ...editing, source: e.target.value })}
              placeholder="LLM"
              className="field"
            />
          </div>
          <div>
            <label htmlFor="lector-glos-target" className="label mb-1.5">
              {tr('side.glossary.targetField')}
            </label>
            <input
              id="lector-glos-target"
              value={editing.target}
              onChange={(e) => setEditing({ ...editing, target: e.target.value })}
              placeholder="大语言模型"
              className="field"
            />
          </div>
          <div>
            <label htmlFor="lector-glos-note" className="label mb-1.5">
              {tr('side.glossary.noteField')}
            </label>
            <textarea
              id="lector-glos-note"
              value={editing.note}
              onChange={(e) => setEditing({ ...editing, note: e.target.value })}
              rows={2}
              className="field resize-none"
            />
          </div>
          {err && <div className="text-[11px] text-danger bg-danger-soft/50 rounded-md px-2 py-1.5">{err}</div>}
          <div className="flex gap-2 pt-1">
            <button
              onClick={save}
              className="btn-primary flex-1 py-2 text-[12px]"
            >
              {tr('side.glossary.save')}
            </button>
            <button
              onClick={() => setEditing(null)}
              className="btn-outline flex-1 py-2 text-[12px]"
            >
              {tr('side.glossary.cancel')}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="px-4 py-3 border-b border-line space-y-2">
            <button
              onClick={startNew}
              className="btn-add py-2 text-[12px]"
            >
              <PlusIcon size={14} />
              {tr('side.glossary.add')}
            </button>
            {entries.length > 0 && (
              <div className="flex gap-2">
                <button
                  onClick={handleExport}
                  className="btn-outline flex-1 py-1.5 text-[11px]"
                >
                  <DownloadIcon size={12} />
                  {tr('side.glossary.export')}
                </button>
                <label className="btn-outline flex-1 py-1.5 text-[11px] cursor-pointer">
                  <UploadIcon size={12} />
                  {tr('side.glossary.import')}
                  <input
                    type="file"
                    accept="application/json,.json"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) void handleImport(f)
                      e.target.value = '' // allow re-importing the same file
                    }}
                  />
                </label>
              </div>
            )}
            {flash && <div className="text-[10px] text-accent text-center bg-accent-softer rounded-md py-1">{flash}</div>}
            <p className="text-[10px] text-ink-faint leading-relaxed">{tr('side.glossary.hint')}</p>
          </div>
          <div className="flex-1 overflow-y-auto">
            {entries.length === 0 ? (
              <Empty text={tr('side.glossary.empty')} />
            ) : (
              entries.map((e) => (
                <div key={e.id} className={`group row ${e.enabled ? '' : 'opacity-50'}`}>
                  <div className="flex items-center gap-2.5">
                    <button
                      onClick={() => onUpdate(e.id, { enabled: !e.enabled })}
                      role="switch"
                      aria-checked={e.enabled}
                      aria-label={tr('aria.enableGlossary')}
                      title={e.enabled ? tr('side.glossary.enabled') : tr('side.glossary.disabled')}
                      className={`w-3.5 h-3.5 rounded-full border flex-shrink-0 transition-colors ${
                        e.enabled
                          ? 'bg-accent border-accent'
                          : 'bg-transparent border-line-strong'
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-[12px] font-medium text-ink truncate">
                        {e.source} <span className="text-ink-faint mx-0.5">→</span> {e.target}
                      </div>
                      {e.note && (
                        <div className="text-[10px] text-ink-faint truncate mt-0.5">{e.note}</div>
                      )}
                    </div>
                    <button
                      onClick={() => startEdit(e)}
                      aria-label={tr('aria.edit')}
                      title={tr('aria.edit')}
                      className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 text-ink-faint hover:text-accent transition-opacity"
                    >
                      <PencilIcon size={14} />
                    </button>
                    <button
                      onClick={() => onRemove(e.id)}
                      aria-label={tr('aria.delete')}
                      title={tr('aria.delete')}
                      className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 text-ink-faint hover:text-danger transition-opacity"
                    >
                      <TrashIcon size={14} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </ViewShell>
  )
}

// memo'd so unrelated App re-renders don't re-render this view when props are unchanged.
export const GlossaryView = memo(GlossaryViewImpl)
