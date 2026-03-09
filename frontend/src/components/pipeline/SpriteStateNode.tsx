import { memo } from 'react'
import { Handle, Position } from '@xyflow/react'
import { StatusBadge, RunButton } from './StoryNode'
import { getSpriteUrl } from '../../data/assetManifest'

interface Props {
  data: {
    character: string
    state: string
    status: string
    onRun: () => void
    onClick: () => void
  }
}

function SpriteStateNode({ data }: Props) {
  const spriteUrl = getSpriteUrl(data.character.toLowerCase(), data.state)

  return (
    <div
      onClick={data.onClick}
      className="rounded-lg border border-teal-600 bg-teal-950 p-2 w-40 shadow-md cursor-pointer hover:border-teal-300 transition-colors"
    >
      <Handle type="target" position={Position.Left} />
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-teal-300 font-bold uppercase tracking-wide">Sprite</span>
        <StatusBadge status={data.status} />
      </div>
      <div className="text-xs font-semibold text-white capitalize mb-1">{data.state}</div>
      {data.status === 'Generated' && (
        <img
          src={spriteUrl}
          alt={data.state}
          className="w-full h-20 object-contain rounded bg-black/30"
          onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
        />
      )}
      <RunButton status={data.status} onRun={(e: React.MouseEvent) => { e.stopPropagation(); data.onRun() }} />
    </div>
  )
}

export default memo(SpriteStateNode)
