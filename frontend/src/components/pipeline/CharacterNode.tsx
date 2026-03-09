import { memo } from 'react'
import { Handle, Position } from '@xyflow/react'
import { StatusBadge, RunButton } from './StoryNode'
import type { Character } from '../../types'

interface Props {
  data: {
    character: Character
    status: string
    onRun: () => void
    onClick: () => void
  }
}

function CharacterNode({ data }: Props) {
  const { character } = data
  return (
    <div
      onClick={data.onClick}
      className="rounded-lg border border-blue-500 bg-blue-950 p-3 w-52 shadow-lg cursor-pointer hover:border-blue-300 transition-colors"
    >
      <Handle type="target" position={Position.Top} />
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-bold text-blue-300 uppercase tracking-wide">Character</span>
        <StatusBadge status={data.status} />
      </div>
      <div className="text-sm font-semibold text-white mb-1">{character.name}</div>
      <div className="text-xs text-gray-400">{character.role}</div>
      <div className="text-xs text-gray-500 mt-1">
        {character.sprite_states.length} sprite states
      </div>
      <RunButton status={data.status} onRun={(e: React.MouseEvent) => { e.stopPropagation(); data.onRun() }} />
      <Handle type="source" position={Position.Right} />
      <Handle type="source" position={Position.Bottom} id="bottom" />
    </div>
  )
}

export default memo(CharacterNode)
