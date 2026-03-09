export interface CharacterState {
  character: string
  state: string
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
}

export interface StoryData {
  title: string
  summary: string
  best_scene_reference_page: number
  characters: Character[]
  pages: Page[]
}

export interface AssetsManifest {
  characters: Record<string, { ref_image: string; sprites: Record<string, string> }>
  pages: Record<string, { background_video?: string; narration_audio?: string }>
}
