export interface CharacterState {
  character: string
  state: string
  sprite_url?: string
}

export interface Character {
  name: string
  role: string
  personality: string
  speech_style: string
  visual_description: string
  emotions: string[]
  best_reference_page: number
  sprite_states: string[]
}

export interface Page {
  page: number
  text: string
  summary: string
  foreground_characters: string[]
  background_characters: string[]
  mood: string
  setting: string
  key_interaction: string
  scene_motion?: string
  character_states: CharacterState[]
  actual_page?: number
  ref_page?: number
  ref_source?: 'pdf' | 'custom'
  ref_image?: string
  bg_url?: string | null
  nar_url?: string | null
}

export interface StoryEdge {
  from: number | string   // system page number or live node id
  to: number | string     // system page number or live node id
  label?: string          // optional condition/description
}

export interface LiveNodeData {
  id: string
  character: string
  bg_url: string
  system_prompt: string
  label: string
  vision?: boolean   // if true, camera frames are forwarded to Gemini Live
}

export interface Shot {
  prompt: string      // narration prose (also used as image caption)
  image_url: string
  nar_url?: string    // active audio asset for this shot
}

export interface ImageStoryNodeData {
  id: string
  label: string
  story_prompt: string        // user's input prompt (renamed from story_text)
  character_refs: string[]   // char slugs → refs/{slug}_ref.png
  background_refs: string[]  // relative asset URLs (library/, refs/, etc.)
  ken_burns: boolean
  num_shots: number
  shots: Shot[]
}

export interface DreamNodeData {
  id: string
  label: string
  character: string
  bg_url: string
  system_prompt: string
  vision?: boolean
  character_refs: string[]
  background_refs: string[]
}

export interface StoryData {
  title: string
  summary: string
  best_scene_reference_page: number
  characters: Character[]
  pages: Page[]
  edges?: StoryEdge[]
  live_nodes?: LiveNodeData[]
  image_nodes?: ImageStoryNodeData[]
  dream_nodes?: DreamNodeData[]
}

export interface SpriteVersion {
  url: string
  created_at: string
  generation_inputs?: {
    name: string
    visual_description: string
    ref_image: string
    state: string
  }
}

export interface AssetsManifest {
  characters: Record<string, { ref_image: string; sprites: Record<string, string> }>
  pages: Record<string, { background_video?: string; narration_audio?: string }>
}
