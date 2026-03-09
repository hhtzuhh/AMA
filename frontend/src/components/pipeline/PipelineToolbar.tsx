import { memo, useState } from 'react'
import { StatusBadge, RunButton } from './StoryNode'
import type { StageInfo } from './NodePanel'

interface Stage {
  id: string
  step: string
  label: string
  script: string
  inputLabel: string
  outputLabel: string
  description: string
  status: string
  onRun: () => void
  onClick: () => void
}

interface PipelineToolbarProps {
  stages: Stage[]
}

function PipelineToolbar({ stages }: PipelineToolbarProps) {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div style={{ background: '#0a0a1a', borderBottom: '1px solid #1e1e3f', flexShrink: 0 }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '6px 12px', gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#6366f1', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Pipeline
        </span>
        <span style={{ fontSize: 11, color: '#4b5563', flex: 1 }}>
          — auto-generate story assets
        </span>
        <button
          onClick={() => setCollapsed(c => !c)}
          style={{ background: 'none', border: 'none', color: '#6b7280', fontSize: 11, cursor: 'pointer', padding: '2px 6px' }}
        >
          {collapsed ? '▶ Show' : '▼ Hide'}
        </button>
      </div>

      {/* Stage cards */}
      {!collapsed && (
        <div style={{ display: 'flex', alignItems: 'stretch', gap: 0, paddingBottom: 10, paddingLeft: 12, paddingRight: 12 }}>
          {stages.map((stage, i) => (
            <div key={stage.id} style={{ display: 'flex', alignItems: 'center' }}>
              {/* Card */}
              <div
                onClick={stage.onClick}
                style={{
                  background: '#0f0f2a',
                  border: '1px solid #312e81',
                  borderRadius: 8,
                  padding: '8px 12px',
                  minWidth: 180,
                  cursor: 'pointer',
                  transition: 'border-color 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = '#6366f1')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = '#312e81')}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#818cf8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Step {i + 1}
                  </span>
                  <StatusBadge status={stage.status} />
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', marginBottom: 2 }}>{stage.label}</div>
                <div style={{ fontSize: 10, color: '#6b7280', fontFamily: 'monospace', marginBottom: 6 }}>
                  {stage.inputLabel} → <span style={{ color: '#818cf8' }}>{stage.outputLabel}</span>
                </div>
                <RunButton
                  status={stage.status}
                  onRun={(e: React.MouseEvent) => { e.stopPropagation(); stage.onRun() }}
                />
              </div>

              {/* Arrow connector */}
              {i < stages.length - 1 && (
                <div style={{ color: '#374151', fontSize: 18, padding: '0 6px', userSelect: 'none' }}>→</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default memo(PipelineToolbar)
