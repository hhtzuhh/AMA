interface Props {
  pageNum: number
  totalPages: number
  spriteState: string
  isNarrating: boolean
  hasNarration: boolean
  onPrev: () => void
  onNext: () => void
  onReplay: () => void
}

export default function TheaterControls({
  pageNum,
  totalPages,
  spriteState,
  isNarrating,
  hasNarration,
  onPrev,
  onNext,
  onReplay,
}: Props) {
  return (
    <div
      className="absolute top-0 left-0 right-0 flex items-center gap-3 px-4 py-2"
      style={{ zIndex: 10, background: 'rgba(0,0,0,0.5)' }}
    >
      {/* Status */}
      <span
        className="text-sm font-mono"
        style={{ color: isNarrating ? '#facc15' : '#ffffff' }}
      >
        {isNarrating ? '🔊 Narrating...' : '💬 Interactive'}
      </span>

      <span className="text-gray-400 text-xs font-mono">
        Page {pageNum} · Max: {spriteState}
      </span>

      <div className="ml-auto flex items-center gap-2">
        <NavButton onClick={onPrev} disabled={totalPages <= 1}>◀</NavButton>
        <span className="text-xs text-gray-400 font-mono">{pageNum}</span>
        <NavButton onClick={onNext} disabled={totalPages <= 1}>▶</NavButton>
        {hasNarration && (
          <button
            onClick={onReplay}
            className="text-xs bg-gray-700 hover:bg-gray-600 text-white px-2 py-1 rounded transition-colors"
          >
            ↺ Replay
          </button>
        )}
      </div>
    </div>
  )
}

function NavButton({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="text-sm bg-gray-700 hover:bg-gray-600 disabled:opacity-40 text-white px-2 py-1 rounded transition-colors"
    >
      {children}
    </button>
  )
}
