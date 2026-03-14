import { Handle, Position } from '@xyflow/react'

interface Props {
  data: {
    node: {
      id: string
      label: string
      character: string
      system_prompt: string
      vision?: boolean
    }
    onClick: () => void
  }
  selected: boolean
}

export default function DreamNode({ data, selected }: Props) {
  const { node, onClick } = data
  return (
    <div
      onClick={onClick}
      style={{
        width: 160,
        background: selected ? '#0d2d2d' : '#061a1a',
        border: `2px solid ${selected ? '#2dd4bf' : '#0d9488'}`,
        borderRadius: 8,
        padding: '8px 10px',
        cursor: 'pointer',
        boxShadow: selected ? '0 0 12px #2dd4bf44' : '0 0 6px #0d948833',
        fontFamily: 'monospace',
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: '#0d9488' }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <span style={{ fontSize: 14 }}>{node.vision ? '✨👁' : '✨'}</span>
        <span style={{ fontSize: 11, fontWeight: 'bold', color: '#2dd4bf' }}>
          {node.label || 'Dream Moment'}
        </span>
      </div>

      {node.character && (
        <div style={{ fontSize: 10, color: '#0f766e' }}>
          as {node.character}
        </div>
      )}

      {node.system_prompt && (
        <div style={{
          fontSize: 9, color: '#6b7280', marginTop: 4,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          maxWidth: 130,
        }}>
          {node.system_prompt.slice(0, 60)}…
        </div>
      )}

      <Handle type="source" position={Position.Right} style={{ background: '#0d9488' }} />
    </div>
  )
}
