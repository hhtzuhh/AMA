import { useEffect, useRef, useState } from 'react'
import { loadStoryData, getPageSpriteState } from '../data/storyData'
import { getSpriteUrl, getSceneUrl, getNarrationUrl, SCENE_PAGES, hasNarration } from '../data/assetManifest'
import type { StoryData } from '../types'
import BackgroundLayer from '../components/theater/BackgroundLayer'
import SpriteLayer from '../components/theater/SpriteLayer'
import NarrationPlayer from '../components/theater/NarrationPlayer'
import TheaterControls from '../components/theater/TheaterControls'

const SPRITE_CHARACTER = 'max'

export default function TheaterPage() {
  const [storyData, setStoryData] = useState<StoryData | null>(null)
  const [pageIdx, setPageIdx] = useState(0)
  const [isNarrating, setIsNarrating] = useState(false)
  const [replayCount, setReplayCount] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const [dims, setDims] = useState({ width: window.innerWidth, height: window.innerHeight })

  useEffect(() => {
    loadStoryData().then(setStoryData)
  }, [])

  useEffect(() => {
    function handleResize() {
      setDims({ width: window.innerWidth, height: window.innerHeight })
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  if (!storyData) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-950 text-white">
        Loading...
      </div>
    )
  }

  const pageNum = SCENE_PAGES[pageIdx]
  const spriteState = getPageSpriteState(storyData.pages, pageNum, SPRITE_CHARACTER)
  const spriteUrl = getSpriteUrl(SPRITE_CHARACTER, spriteState)
  const sceneUrl = getSceneUrl(pageNum)
  const narrationUrl = hasNarration(pageNum) ? getNarrationUrl(pageNum) : ''

  // Use 16:9 aspect ratio contained within the viewport
  const aspect = 16 / 9
  let canvasW = dims.width
  let canvasH = dims.width / aspect
  if (canvasH > dims.height) {
    canvasH = dims.height
    canvasW = dims.height * aspect
  }

  return (
    <div className="flex items-center justify-center h-screen bg-black overflow-hidden">
      <div
        ref={containerRef}
        className="relative overflow-hidden"
        style={{ width: canvasW, height: canvasH }}
      >
        {/* z-index 0: background video */}
        <BackgroundLayer src={sceneUrl} />

        {/* z-index 1: PixiJS sprite animation */}
        <SpriteLayer
          spriteUrl={spriteUrl}
          state={spriteState}
          width={canvasW}
          height={canvasH}
        />

        {/* Hidden audio element */}
        {narrationUrl && (
          <NarrationPlayer
            src={narrationUrl}
            triggerReplay={replayCount}
            onPlay={() => setIsNarrating(true)}
            onEnd={() => setIsNarrating(false)}
          />
        )}

        {/* z-index 10: HUD controls */}
        <TheaterControls
          pageNum={pageNum}
          totalPages={SCENE_PAGES.length}
          spriteState={spriteState}
          isNarrating={isNarrating}
          hasNarration={!!narrationUrl}
          onPrev={() => {
            setIsNarrating(false)
            setPageIdx(i => (i - 1 + SCENE_PAGES.length) % SCENE_PAGES.length)
          }}
          onNext={() => {
            setIsNarrating(false)
            setPageIdx(i => (i + 1) % SCENE_PAGES.length)
          }}
          onReplay={() => setReplayCount(c => c + 1)}
        />
      </div>
    </div>
  )
}
