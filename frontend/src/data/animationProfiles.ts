// Direct port of ANIMATION_PROFILES from test_pygame_canvas.py
export interface AnimationProfile {
  bobAmp: number   // vertical bounce pixels
  bobFreq: number  // Hz
  sway: number     // max rotation degrees
  breathe: number  // scale delta
}

export const ANIMATION_PROFILES: Record<string, AnimationProfile> = {
  idle:        { bobAmp: 3,  bobFreq: 0.8, sway: 0.6, breathe: 0.008 },
  mischievous: { bobAmp: 4,  bobFreq: 1.2, sway: 1.2, breathe: 0.010 },
  chasing:     { bobAmp: 6,  bobFreq: 2.5, sway: 2.0, breathe: 0.015 },
  angry:       { bobAmp: 2,  bobFreq: 4.0, sway: 0.4, breathe: 0.012 },
  happy:       { bobAmp: 5,  bobFreq: 1.6, sway: 1.5, breathe: 0.010 },
  dancing:     { bobAmp: 8,  bobFreq: 2.0, sway: 3.0, breathe: 0.015 },
  sailing:     { bobAmp: 4,  bobFreq: 0.5, sway: 2.0, breathe: 0.006 },
  commanding:  { bobAmp: 1,  bobFreq: 0.5, sway: 0.4, breathe: 0.005 },
  swinging:    { bobAmp: 7,  bobFreq: 1.0, sway: 4.0, breathe: 0.010 },
  riding:      { bobAmp: 5,  bobFreq: 1.4, sway: 1.0, breathe: 0.010 },
  lonely:      { bobAmp: 1,  bobFreq: 0.3, sway: 0.2, breathe: 0.003 },
  waving:      { bobAmp: 3,  bobFreq: 1.0, sway: 0.8, breathe: 0.008 },
  sleeping:    { bobAmp: 1,  bobFreq: 0.2, sway: 0.1, breathe: 0.002 },
  roaring:     { bobAmp: 5,  bobFreq: 2.0, sway: 2.5, breathe: 0.014 },
  scared:      { bobAmp: 3,  bobFreq: 3.0, sway: 1.0, breathe: 0.012 },
  marching:    { bobAmp: 4,  bobFreq: 1.8, sway: 1.2, breathe: 0.008 },
  sad:         { bobAmp: 1,  bobFreq: 0.4, sway: 0.3, breathe: 0.004 },
  running:     { bobAmp: 6,  bobFreq: 3.0, sway: 1.5, breathe: 0.012 },
}

export const DEFAULT_PROFILE: AnimationProfile = {
  bobAmp: 3, bobFreq: 0.8, sway: 0.6, breathe: 0.008,
}

export function getProfile(state: string): AnimationProfile {
  return ANIMATION_PROFILES[state] ?? DEFAULT_PROFILE
}
