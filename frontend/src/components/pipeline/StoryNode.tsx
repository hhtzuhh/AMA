import { memo } from 'react'
import { Handle, Position } from '@xyflow/react'

interface Props {
  data: { title: string; summary: string; onRun: () => void; status: string }
}

function StoryNode({ data }: Props) {
  return (
    <div className="rounded-lg border border-purple-500 bg-purple-950 p-3 w-64 shadow-lg">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-bold text-purple-300 uppercase tracking-wide">Story</span>
        <StatusBadge status={data.status} />
      </div>
      <div className="text-sm font-semibold text-white mb-1">{data.title}</div>
      <div className="text-xs text-gray-400 line-clamp-2">{data.summary}</div>
      <RunButton status={data.status} onRun={data.onRun} />
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}

export function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    Generated: 'bg-green-600',
    Running: 'bg-yellow-500 animate-pulse',
    Pending: 'bg-gray-600',
  }
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full text-white ${colors[status] ?? 'bg-gray-600'}`}>
      {status}
    </span>
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function RunButton({ status, onRun }: { status: string; onRun: (...args: any[]) => void }) {
  return (
    <button
      onClick={onRun}
      disabled={status === 'Running'}
      className="mt-2 w-full text-xs bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 text-white rounded px-2 py-1 transition-colors"
    >
      {status === 'Running' ? '⏳ Running…' : '▶ Run'}
    </button>
  )
}

export default memo(StoryNode)
