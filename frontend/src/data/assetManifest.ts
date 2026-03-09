// Asset URL resolver — swap BASE_URL to switch between local and GCS
const BASE_URL = ''  // empty = relative to public/

// sprites/{character_slug}/{state}.png
export function getSpriteUrl(character: string, state: string): string {
  const slug = character.toLowerCase().replace(/\s+/g, '_')
  return `${BASE_URL}/assets/sprites/${slug}/${state}.png`
}

export function getSceneUrl(pageNum: number): string {
  return `${BASE_URL}/assets/scenes/page_${pageNum}_bg.mp4`
}

export function getNarrationUrl(pageNum: number): string {
  return `${BASE_URL}/assets/audio/page_${pageNum}_narration.wav`
}

export function getRefImageUrl(_character: string, page: number): string {
  return `${BASE_URL}/assets/refs/page_${page}_ref.png`
}

// Pages that have generated background videos
export const SCENE_PAGES = [1, 21, 25]

// Pages that have narration audio
export const NARRATION_PAGES = [21, 3]

export function hasScene(pageNum: number): boolean {
  return SCENE_PAGES.includes(pageNum)
}

export function hasNarration(pageNum: number): boolean {
  return NARRATION_PAGES.includes(pageNum)
}
