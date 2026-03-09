import { memo } from 'react'
import { Handle, Position } from '@xyflow/react'
import { StatusBadge, RunButton } from './StoryNode'

interface StageData {
  label: string
  script: string
  inputLabel: string
  outputLabel: string
  status: string
  onRun: () => void
  onClick: () => void
}

function PipelineStageNode({ data }: { data: StageData }) {
  return (
    <div onClick={data.onClick} className="rounded-lg border border-indigo-500 bg-indigo-950 p-3 w-56 shadow-lg cursor-pointer hover:border-indigo-300 transition-colors">
      <Handle type="target" position={Position.Left} />
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-bold text-indigo-300 uppercase tracking-wide">Pipeline</span>
        <StatusBadge status={data.status} />
      </div>
      <div className="text-sm font-semibold text-white mb-1">{data.label}</div>
      <div className="text-xs text-gray-500 font-mono mb-1">{data.script}</div>
      <div className="text-xs text-gray-400">{data.inputLabel} → <span className="text-indigo-300">{data.outputLabel}</span></div>
      <RunButton status={data.status} onRun={(e: React.MouseEvent) => { e.stopPropagation(); data.onRun() }} />
      <Handle type="source" position={Position.Right} />
      <Handle type="source" position={Position.Bottom} id="bottom" />
    </div>
  )
}

export default memo(PipelineStageNode)
