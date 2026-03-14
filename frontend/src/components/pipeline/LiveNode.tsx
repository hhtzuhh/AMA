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

export default function LiveNode({ data, selected }: Props) {
  const { node, onClick } = data
  return (
    <div
      onClick={onClick}
      style={{
        width: 160,
        background: selected ? '#2d1b4e' : '#1a0d33',
        border: `2px solid ${selected ? '#a855f7' : '#7c3aed'}`,
        borderRadius: 8,
        padding: '8px 10px',
        cursor: 'pointer',
        boxShadow: selected ? '0 0 12px #a855f744' : '0 0 6px #7c3aed33',
        fontFamily: 'monospace',
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: '#7c3aed' }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <span style={{ fontSize: 14 }}>{node.vision ? '🎤👁' : '🎤'}</span>
        <span style={{ fontSize: 11, fontWeight: 'bold', color: '#c084fc' }}>
          {node.label || 'Live Interaction'}
        </span>
      </div>

      {node.character && (
        <div style={{ fontSize: 10, color: '#9333ea' }}>
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

      <Handle type="source" position={Position.Right} style={{ background: '#7c3aed' }} />
    </div>
  )
}
