import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import type { StoryData, StoryEdge } from '../types'
import BackgroundLayer from '../components/theater/BackgroundLayer'
import SpriteLayer from '../components/theater/SpriteLayer'
import NarrationPlayer from '../components/theater/NarrationPlayer'
import TheaterControls from '../components/theater/TheaterControls'

const API = 'http://localhost:8000'

function assetUrl(projectId: string, path: string): string {
  return `${API}/api/projects/${projectId}/assets/${path}`
}

export default function TheaterPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const [storyData, setStoryData] = useState<StoryData | null>(null)
  const [manifest, setManifest] = useState<any>(null)
  const [edges, setEdges] = useState<StoryEdge[]>([])
  const [currentPageNum, setCurrentPageNum] = useState<number | null>(null)
  const [isNarrating, setIsNarrating] = useState(false)
  const [replayCount, setReplayCount] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const [dims, setDims] = useState({ width: window.innerWidth, height: window.innerHeight })

  useEffect(() => {
    if (!projectId) return
    Promise.all([
      fetch(`${API}/api/projects/${projectId}/story`).then(r => r.ok ? r.json() : null),
      fetch(`${API}/api/projects/${projectId}/manifest`).then(r => r.ok ? r.json() : null),
      fetch(`${API}/api/projects/${projectId}/edges`).then(r => r.ok ? r.json() : { edges: [] }),
    ]).then(([story, mani, edgeData]) => {
      setStoryData(story)
      setManifest(mani)
      setEdges(edgeData?.edges ?? [])
      if (story?.pages?.length > 0) {
        setCurrentPageNum(story.pages[0].page)
      }
    })
  }, [projectId])

  useEffect(() => {
    function handleResize() {
      setDims({ width: window.innerWidth, height: window.innerHeight })
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  if (!storyData || currentPageNum === null) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-950 text-white">
        Loading...
      </div>
    )
  }

  const currentPage = storyData.pages.find(p => p.page === currentPageNum)!

  // Resolve background URL — story_data.bg_url is the active selection,
  // fall back to manifest's latest version if not set
  const pageManifest = manifest?.pages?.[String(currentPageNum)]
  const bgEntry = pageManifest?.background
  const bgPath = currentPage.bg_url
    ?? (bgEntry?.versions?.length > 0 ? bgEntry.versions[bgEntry.current ?? 0]?.url : null)
  const bgUrl = bgPath ? assetUrl(projectId!, bgPath) : ''

  // Resolve narration URL — same priority: story_data.nar_url first, then manifest latest
  const narEntry = pageManifest?.narration
  const narPath = currentPage.nar_url
    ?? (narEntry?.versions?.length > 0 ? narEntry.versions[narEntry.versions.length - 1]?.url : null)
  const narUrl = narPath ? assetUrl(projectId!, narPath) : ''

  // Resolve sprite: use first foreground character, fallback to first character_state
  const fgCharName = currentPage.foreground_characters?.[0]
  const csEntry = fgCharName
    ? currentPage.character_states?.find(c => c.character.toLowerCase() === fgCharName.toLowerCase())
    : currentPage.character_states?.[0]

  let spriteUrl = ''
  let spriteState = csEntry?.state ?? 'idle'
  const charName = csEntry?.character ?? fgCharName ?? ''

  if (csEntry?.sprite_url) {
    // Page-specific sprite override
    spriteUrl = assetUrl(projectId!, csEntry.sprite_url)
  } else if (charName) {
    const slug = charName.toLowerCase().replace(/\s+/g, '_')
    const charManifest = manifest?.characters?.[slug]
    const stateEntry = charManifest?.sprites?.[spriteState]
    const versionUrl = stateEntry?.versions?.length > 0
      ? stateEntry.versions[stateEntry.current ?? 0]?.url
      : null
    if (versionUrl) spriteUrl = assetUrl(projectId!, versionUrl)
  }

  // Edge navigation
  const nextEdges = edges.filter(e => e.from === currentPageNum)
  const prevEdges = edges.filter(e => e.to === currentPageNum)

  const goToPage = (pageNum: number) => {
    setIsNarrating(false)
    setReplayCount(0)
    setCurrentPageNum(pageNum)
  }

  // Canvas sizing — 16:9 contained within viewport
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
        <BackgroundLayer src={bgUrl} />

        {/* z-index 1: PixiJS sprite animation */}
        {spriteUrl && (
          <SpriteLayer
            spriteUrl={spriteUrl}
            state={spriteState}
            width={canvasW}
            height={canvasH}
          />
        )}

        {/* Hidden audio element */}
        {narUrl && (
          <NarrationPlayer
            src={narUrl}
            triggerReplay={replayCount}
            onPlay={() => setIsNarrating(true)}
            onEnd={() => {
              setIsNarrating(false)
              // Auto-advance after narration if exactly one outgoing edge
              if (nextEdges.length === 1) goToPage(nextEdges[0].to)
            }}
          />
        )}

        {/* z-index 10: HUD controls */}
        <TheaterControls
          pageNum={currentPageNum}
          totalPages={storyData.pages.length}
          charName={charName}
          spriteState={spriteState}
          isNarrating={isNarrating}
          hasNarration={!!narUrl}
          canGoPrev={prevEdges.length > 0}
          canGoNext={nextEdges.length > 0}
          onPrev={() => prevEdges.length > 0 && goToPage(prevEdges[0].from)}
          onNext={() => nextEdges.length > 0 && goToPage(nextEdges[0].to)}
          onReplay={() => setReplayCount(c => c + 1)}
        />
      </div>
    </div>
  )
}
