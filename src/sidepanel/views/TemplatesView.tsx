import { useState, useRef, memo, type DragEvent } from 'react'
import { validateTemplate, type PromptTemplate } from '../../shared/promptTemplates'
import type { StringKey } from '../../shared/i18n'
import { PlusIcon, GripVerticalIcon, PencilIcon, TrashIcon } from '../../shared/icons'
import { ViewShell, Empty } from '../components/leaf'

interface TemplatesViewProps {
  templates: PromptTemplate[]
  titleFor: (t: PromptTemplate) => string
  tr: (key: StringKey) => string
  onAdd: (t: { title: string; content: string; titleKey?: StringKey }) => void
  onUpdate: (id: string, patch: Partial<PromptTemplate>) => void
  onRemove: (id: string) => void
  onReorder: (orderedIds: string[]) => void
}

function TemplatesViewImpl({
  templates,
  titleFor,
  tr,
  onAdd,
  onUpdate,
  onRemove,
  onReorder,
}: TemplatesViewProps) {
  const [editing, setEditing] = useState<{ id: string | null; title: string; content: string } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const dragId = useRef<string | null>(null)

  const startNew = () => {
    setEditing({ id: null, title: '', content: '' })
    setErr(null)
  }
  const startEdit = (tpl: PromptTemplate) => {
    setEditing({ id: tpl.id, title: tpl.title, content: tpl.content })
    setErr(null)
  }

  const save = () => {
    if (!editing) return
    const v = validateTemplate(editing)
    if (!v.ok) {
      setErr(
        v.reason === 'empty-title'
          ? tr('side.templates.errTitle')
          : v.reason === 'empty-content'
            ? tr('side.templates.errContent')
            : (v.reason ?? '')
      )
      return
    }
    if (editing.id) {
      // Built-in templates: only allow editing the title (keep content + builtIn).
      // Clear titleKey so the custom title actually displays — the display path
      // prefers titleKey (i18n-resolved) over title, so keeping it would make
      // the edit a silent no-op.
      const existing = templates.find((t) => t.id === editing.id)
      if (existing?.builtIn) {
        onUpdate(editing.id, { title: editing.title, titleKey: undefined })
      } else {
        onUpdate(editing.id, { title: editing.title, content: editing.content })
      }
    } else {
      onAdd({ title: editing.title, content: editing.content })
    }
    setEditing(null)
  }

  const onDragStart = (id: string) => (e: DragEvent) => {
    dragId.current = id
    e.dataTransfer.effectAllowed = 'move'
  }
  const onDrop = (targetId: string) => (e: DragEvent) => {
    e.preventDefault()
    const sourceId = dragId.current
    dragId.current = null
    if (!sourceId || sourceId === targetId) return
    const ids = templates.map((t) => t.id)
    const from = ids.indexOf(sourceId)
    const to = ids.indexOf(targetId)
    if (from === -1 || to === -1) return
    ids.splice(to, 0, ids.splice(from, 1)[0])
    onReorder(ids)
  }

  return (
    <ViewShell title={tr('side.templates.title')}>
      {editing ? (
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3.5">
          <div>
            <label htmlFor="lector-tpl-title" className="label mb-1.5">
              {tr('side.templates.titleField')}
            </label>
            <input
              id="lector-tpl-title"
              value={editing.title}
              onChange={(e) => setEditing({ ...editing, title: e.target.value })}
              className="field"
            />
          </div>
          <div>
            <label htmlFor="lector-tpl-content" className="label mb-1.5">
              {tr('side.templates.contentField')}
            </label>
            <textarea
              id="lector-tpl-content"
              value={editing.content}
              onChange={(e) => setEditing({ ...editing, content: e.target.value })}
              rows={6}
              disabled={editing.id ? templates.find((t) => t.id === editing.id)?.builtIn : false}
              className="field font-mono resize-none disabled:opacity-60"
            />
            <p className="text-[10px] text-ink-faint mt-1.5">{tr('side.templates.hint')}</p>
          </div>
          {err && <div className="text-[11px] text-danger bg-danger-soft/50 rounded-md px-2 py-1.5">{err}</div>}
          <div className="flex gap-2 pt-1">
            <button
              onClick={save}
              className="btn-primary flex-1 py-2 text-[12px]"
            >
              {tr('side.templates.save')}
            </button>
            <button
              onClick={() => setEditing(null)}
              className="btn-outline flex-1 py-2 text-[12px]"
            >
              {tr('side.templates.cancel')}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="px-4 py-3 border-b border-line">
            <button
              onClick={startNew}
              className="btn-add py-2 text-[12px]"
            >
              <PlusIcon size={14} />
              {tr('side.templates.add')}
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {templates.length === 0 ? (
              <Empty text={tr('side.templates.empty')} />
            ) : (
              templates.map((tpl) => (
                <div
                  key={tpl.id}
                  draggable
                  onDragStart={onDragStart(tpl.id)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={onDrop(tpl.id)}
                  className="group row cursor-grab active:cursor-grabbing hover:bg-surface-muted/60"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-ink-faint hover:text-ink-soft select-none flex-shrink-0">
                      <GripVerticalIcon size={14} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[12px] font-medium text-ink flex items-center gap-1.5">
                        {titleFor(tpl)}
                        {tpl.builtIn && (
                          <span className="chip-builtIn">
                            {tr('side.templates.builtIn')}
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-ink-faint truncate mt-0.5">
                        {tpl.content.replace(/\s+/g, ' ').trim()}
                      </div>
                    </div>
                    <button
                      onClick={() => startEdit(tpl)}
                      aria-label={tr('aria.edit')}
                      title={tr('aria.edit')}
                      className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 text-ink-faint hover:text-accent transition-opacity"
                    >
                      <PencilIcon size={14} />
                    </button>
                    {!tpl.builtIn && (
                      <button
                        onClick={() => onRemove(tpl.id)}
                        aria-label={tr('aria.delete')}
                        title={tr('aria.delete')}
                        className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 text-ink-faint hover:text-danger transition-opacity"
                      >
                        <TrashIcon size={14} />
                      </button>
                    )}
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
export const TemplatesView = memo(TemplatesViewImpl)
