import { Handle, Position } from '@xyflow/react'
import type { ImageStoryNodeData } from '../../types'

interface Props {
  data: {
    node: ImageStoryNodeData
    onClick: () => void
  }
  selected: boolean
}

export default function ImageStoryNode({ data, selected }: Props) {
  const { node, onClick } = data
  const shotCount = node.shots?.length ?? 0
  const firstShot = node.shots?.[0]?.image_url

  return (
    <div
      onClick={onClick}
      style={{
        width: 172,
        background: selected ? '#2d1800' : '#1a0e00',
        border: `2px solid ${selected ? '#f59e0b' : '#b45309'}`,
        borderRadius: 8,
        padding: '8px 10px',
        cursor: 'pointer',
        boxShadow: selected ? '0 0 14px #f59e0b44' : '0 0 6px #b4530933',
        fontFamily: 'monospace',
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: '#b45309' }} />

      {/* Thumbnail strip */}
      {firstShot && (
        <div style={{
          height: 54, marginBottom: 6, borderRadius: 4, overflow: 'hidden',
          background: '#0f0800', border: '1px solid #374151',
        }}>
          <img
            src={`http://localhost:8000/api/projects/${_extractProjectId()}/assets/${firstShot}`}
            alt="shot"
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            onError={e => { (e.target as HTMLImageElement).style.opacity = '0.15' }}
          />
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}>
        <span style={{ fontSize: 13 }}>🎨</span>
        <span style={{ fontSize: 11, fontWeight: 'bold', color: '#fbbf24' }}>
          {node.label || 'Image Story'}
        </span>
      </div>

      {node.story_prompt && (
        <div style={{
          fontSize: 9, color: '#78716c', marginTop: 2,
          overflow: 'hidden', textOverflow: 'ellipsis',
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
          lineHeight: 1.4,
        }}>
          {node.story_prompt}
        </div>
      )}

      <div style={{ display: 'flex', gap: 4, marginTop: 5, flexWrap: 'wrap' }}>
        {shotCount > 0 ? (
          <span style={{
            fontSize: 9, background: '#451a03', color: '#fbbf24',
            borderRadius: 3, padding: '1px 5px',
          }}>
            {shotCount} shot{shotCount !== 1 ? 's' : ''}
          </span>
        ) : (
          <span style={{ fontSize: 9, color: '#57534e' }}>no shots yet</span>
        )}
        {node.ken_burns && (
          <span style={{
            fontSize: 9, background: '#1c1917', color: '#a78bfa',
            borderRadius: 3, padding: '1px 5px',
          }}>KB</span>
        )}
      </div>

      <Handle type="source" position={Position.Right} style={{ background: '#b45309' }} />
    </div>
  )
}

// Extracts projectId from the current URL path /pipeline/:projectId
function _extractProjectId(): string {
  const parts = window.location.pathname.split('/')
  const idx = parts.indexOf('pipeline')
  return idx >= 0 ? parts[idx + 1] : ''
}
