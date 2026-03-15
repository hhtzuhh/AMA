import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import type { StoryData, StoryEdge, LiveNodeData, ImageStoryNodeData, DreamNodeData } from '../types'
import BackgroundLayer from '../components/theater/BackgroundLayer'
import SpriteLayer, { type SpriteEntry } from '../components/theater/SpriteLayer'
import NarrationPlayer from '../components/theater/NarrationPlayer'
import TheaterControls from '../components/theater/TheaterControls'
import LiveSession from '../components/theater/LiveSession'
import DreamSession from '../components/theater/DreamSession'
import ImageStorySlideshow from '../components/theater/ImageStorySlideshow'

import { API_URL as API } from '../config'

function assetUrl(projectId: string, path: string): string {
  return `${API}/api/projects/${projectId}/assets/${path}`
}

export default function TheaterPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const [storyData, setStoryData] = useState<StoryData | null>(null)
  const [manifest, setManifest] = useState<Record<string, unknown> | null>(null)
  const [edges, setEdges] = useState<StoryEdge[]>([])
  const [currentNodeId, setCurrentNodeId] = useState<number | string | null>(null)
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
      if (edgeData?.edges?.length > 0) {
        // Find a node with no incoming edges (start node)
        const targets = new Set(edgeData.edges.map((e: any) => String(e.to)))
        const allIds = [
          ...(story?.pages ?? []).map((p: any) => String(p.page)),
          ...(story?.live_nodes ?? []).map((n: any) => n.id),
          ...(story?.image_nodes ?? []).map((n: any) => n.id),
          ...(story?.dream_nodes ?? []).map((n: any) => n.id),
        ]
        const startId = allIds.find(id => !targets.has(id))
        if (startId) {
          const num = parseInt(startId)
          setCurrentNodeId(isNaN(num) ? startId : num)
        } else if (story?.dream_nodes?.length > 0) {
          setCurrentNodeId(story.dream_nodes[0].id)
        } else if (story?.pages?.length > 0) {
          setCurrentNodeId(story.pages[0].page)
        }
      } else if (story?.dream_nodes?.length > 0) {
        setCurrentNodeId(story.dream_nodes[0].id)
      } else if (story?.image_nodes?.length > 0) {
        setCurrentNodeId(story.image_nodes[0].id)
      } else if (story?.pages?.length > 0) {
        setCurrentNodeId(story.pages[0].page)
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

  if (!storyData || currentNodeId === null) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-950 text-white">
        Loading...
      </div>
    )
  }

  const isLiveNode = typeof currentNodeId === 'string' && String(currentNodeId).startsWith('live_')
  const isImageNode = typeof currentNodeId === 'string' && String(currentNodeId).startsWith('img_')
  const isDreamNode = typeof currentNodeId === 'string' && String(currentNodeId).startsWith('dream_')
  const liveNode: LiveNodeData | null = isLiveNode
    ? (storyData.live_nodes ?? []).find(n => n.id === currentNodeId) ?? null
    : null
  const imageNode: ImageStoryNodeData | null = isImageNode
    ? (storyData.image_nodes ?? []).find(n => n.id === currentNodeId) ?? null
    : null
  const dreamNode: DreamNodeData | null = isDreamNode
    ? (storyData.dream_nodes ?? []).find(n => n.id === currentNodeId) ?? null
    : null
  const currentPage = !isLiveNode && !isImageNode && !isDreamNode
    ? storyData.pages.find(p => p.page === (currentNodeId as number))!
    : null

  // Edge navigation
  const nextEdges = edges.filter(e => String(e.from) === String(currentNodeId))
  const prevEdges = edges.filter(e => String(e.to) === String(currentNodeId))

  const goToNode = (nodeId: number | string) => {
    setIsNarrating(false)
    setReplayCount(0)
    setCurrentNodeId(nodeId)
  }

  // Resolve bg + sprite
  let bgUrl = ''
  let sprites: SpriteEntry[] = []
  let charName = ''
  let spriteState = 'idle'
  let narUrl = ''

  if (isImageNode) {
    // Image story nodes render via ImageStorySlideshow — no bg/sprite needed here
  } else if (isDreamNode && dreamNode) {
    if (dreamNode.bg_url) bgUrl = assetUrl(projectId!, dreamNode.bg_url)
    if (dreamNode.character) {
      charName = dreamNode.character
      const slug = charName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
      const spriteState = dreamNode.character_sprite || 'idle'
      const charManifest = (manifest as any)?.characters?.[slug]
      // Try selected state → idle → any available state
      const allStates = Object.keys(charManifest?.sprites ?? {})
      const stateEntry = charManifest?.sprites?.[spriteState]
        ?? charManifest?.sprites?.['idle']
        ?? (allStates.length > 0 ? charManifest?.sprites?.[allStates[0]] : null)
      const versions = stateEntry?.versions ?? []
      const versionUrl = versions.length > 0 ? versions[versions.length - 1]?.url : null
      if (versionUrl) sprites = [{ url: assetUrl(projectId!, versionUrl as string), state: spriteState }]
    }
  } else if (isLiveNode && liveNode) {
    if (liveNode.bg_url) bgUrl = assetUrl(projectId!, liveNode.bg_url)
    if (liveNode.character) {
      charName = liveNode.character
      const slug = charName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
      const spriteState = liveNode.character_sprite || 'idle'
      const charManifest = (manifest as any)?.characters?.[slug]
      const stateEntry = charManifest?.sprites?.[spriteState]
        ?? charManifest?.sprites?.['idle']  // fallback to idle if selected state has no sprites
      const versionUrl = stateEntry?.versions?.length > 0
        ? stateEntry.versions[stateEntry.current ?? stateEntry.versions.length - 1]?.url : null
      if (versionUrl) sprites = [{ url: assetUrl(projectId!, versionUrl as string), state: spriteState }]
    }
  } else if (currentPage) {
    const pageManifest = (manifest as any)?.pages?.[String(currentNodeId)]
    const bgEntry = pageManifest?.background
    const bgPath = currentPage.bg_url
      ?? (bgEntry?.versions?.length > 0 ? bgEntry.versions[bgEntry.current ?? 0]?.url : null)
    if (bgPath) bgUrl = assetUrl(projectId!, bgPath as string)

    const fgNames: string[] = (currentPage.character_states ?? []).map(cs => cs.character)

    function resolveSprite(name: string): SpriteEntry | null {
      const cs = currentPage!.character_states?.find(
        c => c.character.toLowerCase() === name.toLowerCase()
      )
      const state = cs?.state ?? 'idle'
      let url = ''
      if (cs?.sprite_url) {
        url = assetUrl(projectId!, cs.sprite_url)
      } else {
        const slug = name.toLowerCase().replace(/\s+/g, '_')
        const charManifest = (manifest as any)?.characters?.[slug]
        const stateEntry = charManifest?.sprites?.[state]
        const versionUrl = stateEntry?.versions?.length > 0
          ? stateEntry.versions[stateEntry.current ?? 0]?.url : null
        if (versionUrl) url = assetUrl(projectId!, versionUrl as string)
      }
      return url ? { url, state } : null
    }

    sprites = fgNames.map(resolveSprite).filter(Boolean) as SpriteEntry[]
    const firstCs = currentPage.character_states?.[0]
    charName = firstCs?.character ?? ''
    spriteState = firstCs?.state ?? 'idle'

    // Narration
    const narEntry = pageManifest?.narration
    const narPath = currentPage.nar_url
      ?? (narEntry?.versions?.length > 0 ? narEntry.versions[narEntry.versions.length - 1]?.url : null)
    narUrl = narPath ? assetUrl(projectId!, narPath as string) : ''
  }

  // Canvas sizing
  const aspect = 16 / 9
  let canvasW = dims.width
  let canvasH = dims.width / aspect
  if (canvasH > dims.height) {
    canvasH = dims.height
    canvasW = dims.height * aspect
  }

  return (
    <div className="flex items-center justify-center h-screen bg-black overflow-hidden">
      <div ref={containerRef} className="relative overflow-hidden" style={{ width: canvasW, height: canvasH }}>
        {isImageNode && imageNode ? (
          <ImageStorySlideshow
            key={`${currentNodeId}_${replayCount}`}
            projectId={projectId!}
            node={imageNode}
            onDone={() => {
              setIsNarrating(false)
              if (nextEdges.length === 1) {
                const to = nextEdges[0].to
                const num = typeof to === 'number' ? to : parseInt(String(to).replace('page_', ''))
                goToNode(isNaN(num) ? to : num)
              }
            }}
          />
        ) : (
          <>
            <BackgroundLayer src={bgUrl} />
            {sprites.length > 0 && <SpriteLayer sprites={sprites} width={canvasW} height={canvasH} />}
            {isDreamNode && dreamNode ? (
              <DreamSession
                projectId={projectId!}
                node={dreamNode}
                onNavigate={(nid) => {
                  const numId = parseInt(nid.replace('page_', ''))
                  goToNode(isNaN(numId) ? nid : numId)
                }}
              />
            ) : isLiveNode && liveNode ? (
              <LiveSession
                projectId={projectId!}
                node={liveNode}
                onNavigate={(nid) => {
                  const numId = parseInt(nid.replace('page_', ''))
                  goToNode(isNaN(numId) ? nid : numId)
                }}
              />
            ) : (
              currentPage && narUrl && (
                <NarrationPlayer
                  src={narUrl}
                  triggerReplay={replayCount}
                  onPlay={() => setIsNarrating(true)}
                  onEnd={() => {
                    setIsNarrating(false)
                    if (nextEdges.length === 1) {
                      const to = nextEdges[0].to
                      const num = typeof to === 'number' ? to : parseInt(String(to).replace('page_', ''))
                      goToNode(isNaN(num) ? to : num)
                    }
                  }}
                />
              )
            )}
          </>
        )}

        <TheaterControls
          pageNum={isImageNode ? `🎨 ${imageNode?.label ?? 'Image Story'}` : isLiveNode ? `🎤 ${liveNode?.label ?? 'Live'}` : isDreamNode ? `✨ ${dreamNode?.label ?? 'Dream'}` : String(currentNodeId)}
          totalPages={storyData.pages.length + (storyData.live_nodes?.length ?? 0) + (storyData.image_nodes?.length ?? 0) + (storyData.dream_nodes?.length ?? 0)}
          charName={charName}
          spriteState={isLiveNode || isImageNode || isDreamNode ? 'idle' : spriteState}
          isNarrating={isNarrating}
          hasNarration={!isLiveNode && !isImageNode && !isDreamNode && !!narUrl}
          canGoPrev={prevEdges.length > 0}
          canGoNext={nextEdges.length > 0}
          onPrev={() => {
            if (prevEdges.length > 0) {
              const f = prevEdges[0].from
              goToNode(typeof f === 'number' ? f : (isNaN(parseInt(String(f))) ? f : parseInt(String(f))))
            }
          }}
          onNext={() => {
            if (nextEdges.length > 0) {
              const t = nextEdges[0].to
              goToNode(typeof t === 'number' ? t : (isNaN(parseInt(String(t))) ? t : parseInt(String(t))))
            }
          }}
          onReplay={() => setReplayCount(c => c + 1)}
        />
      </div>
    </div>
  )
}
