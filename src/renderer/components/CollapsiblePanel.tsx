import { useState, type ReactNode } from 'react'

interface CollapsiblePanelProps {
  title: string
  children: ReactNode
  defaultOpen?: boolean
}

/**
 * Collapsible panel wrapper — click header to expand/collapse.
 * Used to wrap sidebar sections so users can hide what they don't need.
 */
export function CollapsiblePanel({ title, children, defaultOpen = true }: CollapsiblePanelProps) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <section className={'panel collapsible' + (open ? '' : ' collapsed')}>
      <div className="panel-header" onClick={() => setOpen(!open)}>
        <h2>{title}</h2>
        <span className="collapse-arrow">{open ? '\u25BC' : '\u25B6'}</span>
      </div>
      <div className="panel-content">
        {children}
      </div>
    </section>
  )
}
