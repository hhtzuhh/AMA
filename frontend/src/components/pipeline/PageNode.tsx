import { memo } from 'react'
import { Handle, Position } from '@xyflow/react'
import { StatusBadge } from './StoryNode'
import type { Page } from '../../types'


export function charSlug(name: string) {
  return name.toLowerCase().replace(/\s+/g, '_')
}

interface Props {
  data: {
    page: Page
    status: string
    charSpriteStatus: Record<string, 'done' | 'running' | 'pending'>
    bgStatus: 'done' | 'running' | 'pending'
    audioStatus: 'done' | 'running' | 'pending'
    onClick: () => void
  }
  selected?: boolean
}

function PageNode({ data, selected }: Props) {
  const { page, charSpriteStatus = {}, bgStatus = 'pending', audioStatus = 'pending' } = data
  return (
    <div
      onClick={data.onClick}
      className="rounded-lg shadow-md cursor-pointer transition-colors overflow-hidden"
      style={{
        width: 165,
        border: selected ? '2px solid #818cf8' : '1px solid #4b5563',
        background: selected ? '#13132a' : '#111827',
        boxShadow: selected ? '0 0 0 1px #6366f1, 0 4px 12px rgba(99,102,241,0.25)' : undefined,
      }}
    >
      <Handle type="target" position={Position.Left} />
      <div className="p-2">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-bold text-gray-300">P{page.page}</span>
          <StatusBadge status={data.status} />
        </div>
        <div
          className="text-xs text-gray-400 leading-tight mb-2"
          style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
        >
          {page.summary || page.text || '—'}
        </div>

        {/* Per-character sprite badges */}
        {page.character_states.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-1">
            {page.character_states.map(cs => (
              <AssetBadge
                key={cs.character}
                label={cs.character.split(' ')[0]}
                sublabel={cs.state}
                status={charSpriteStatus[cs.character] ?? 'pending'}
              />
            ))}
          </div>
        )}

        {/* BG + Audio */}
        <div className="flex gap-1 mb-1">
          <AssetBadge label="BG" status={bgStatus} />
          <AssetBadge label="Audio" status={audioStatus} />
        </div>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

type Status = 'done' | 'running' | 'pending'

function AssetBadge({ label, sublabel, status }: { label: string; sublabel?: string; status: Status }) {
  const styles: Record<Status, { bg: string; color: string; border: string; icon: string }> = {
    done:    { bg: '#166534', color: '#86efac', border: '#22c55e', icon: '✓' },
    running: { bg: '#78350f', color: '#fde68a', border: '#f59e0b', icon: '⟳' },
    pending: { bg: '#1f2937', color: '#4b5563', border: '#374151', icon: '○' },
  }
  const s = styles[status]
  return (
    <span
      className="text-xs font-semibold px-1.5 py-0.5 rounded inline-flex items-center gap-0.5"
      style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}` }}
    >
      <span>{s.icon}</span>
      <span>{label}</span>
      {sublabel && <span style={{ opacity: 0.7, fontSize: 10 }}>({sublabel})</span>}
    </span>
  )
}

export default memo(PageNode)
