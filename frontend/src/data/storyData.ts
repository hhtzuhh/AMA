import type { StoryData } from '../types'

let cached: StoryData | null = null

export async function loadStoryData(): Promise<StoryData> {
  if (cached) return cached
  const res = await fetch('/story_data.json')
  cached = await res.json() as StoryData
  return cached
}

export function getPageSpriteState(
  pages: StoryData['pages'],
  pageNum: number,
  character: string,
): string {
  const page = pages.find(p => p.page === pageNum)
  if (!page) return 'idle'
  const cs = page.character_states.find(
    c => c.character.toLowerCase() === character.toLowerCase()
  )
  return cs?.state ?? 'idle'
}
