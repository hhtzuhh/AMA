import { useEffect, useRef } from 'react'
import * as PIXI from 'pixi.js'
import { getProfile } from '../../data/animationProfiles'

export interface SpriteEntry {
  url: string
  state: string
}

interface Props {
  sprites: SpriteEntry[]   // all foreground characters for this page
  width: number
  height: number
}

const SPRITE_HEIGHT_RATIO = 0.6

// Horizontal anchor positions for 1–4 characters
const X_POSITIONS: Record<number, number[]> = {
  1: [0.5],
  2: [0.3, 0.7],
  3: [0.2, 0.5, 0.8],
  4: [0.15, 0.38, 0.62, 0.85],
}

export default function SpriteLayer({ sprites, width, height }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const appRef = useRef<PIXI.Application | null>(null)
  const latestProps = useRef({ sprites, width, height })
  latestProps.current = { sprites, width, height }

  // Initialize PixiJS app once
  useEffect(() => {
    if (!containerRef.current) return

    const app = new PIXI.Application()
    let destroyed = false

    app.init({
      width: latestProps.current.width,
      height: latestProps.current.height,
      backgroundAlpha: 0,
      antialias: true,
    }).then(() => {
      if (destroyed) {
        app.destroy(true, { children: true })
        return
      }
      appRef.current = app
      containerRef.current?.appendChild(app.canvas)
      app.canvas.style.position = 'absolute'
      app.canvas.style.inset = '0'
      app.canvas.style.zIndex = '1'
      app.canvas.style.pointerEvents = 'none'
      // Init finished — load whatever sprites are current now
      loadSprites(latestProps.current.sprites, latestProps.current.width, latestProps.current.height)
    })

    return () => {
      destroyed = true
      if (appRef.current) {
        appRef.current.destroy(true, { children: true })
        appRef.current = null
      }
    }
  }, [])

  // Resize canvas when dimensions change
  useEffect(() => {
    const app = appRef.current
    if (!app || !app.renderer) return
    app.renderer.resize(width, height)
  }, [width, height])

  // Reload all sprites when the list or dimensions change (app already ready path)
  useEffect(() => {
    if (!appRef.current?.stage) return
    loadSprites(sprites, width, height)
  }, [sprites, width, height])

  function loadSprites(entries: SpriteEntry[], w: number, h: number) {
    const app = appRef.current
    if (!app?.stage) return

    const xPositions = X_POSITIONS[Math.min(entries.length, 4)] ?? X_POSITIONS[4]

    // Clear existing children + ticker listeners
    app.stage.removeChildren()
    app.ticker.remove(animateTick)

    // Track per-sprite refs for animation
    const spriteRefs: Array<{ pixi: PIXI.Sprite; state: string }> = []

    Promise.all(
      entries.map(async (entry, i) => {
        try {
          const texture = await PIXI.Assets.load(entry.url)
          if (!appRef.current) return  // unmounted during load

          const sprite = new PIXI.Sprite(texture)
          const targetHeight = h * SPRITE_HEIGHT_RATIO
          const scale = targetHeight / sprite.texture.height
          sprite.scale.set(scale)
          sprite.anchor.set(0.5, 1)
          sprite.x = w * (xPositions[i] ?? 0.5)
          sprite.y = h - 20

          app.stage.addChild(sprite)
          spriteRefs.push({ pixi: sprite, state: entry.state })
        } catch {
          console.warn('Sprite not found:', entry.url)
        }
      })
    ).then(() => {
      if (!appRef.current) return
      app.ticker.remove(animateTick)
      app.ticker.add(animateTick)
    })

    function animateTick() {
      const t = performance.now() / 1000
      spriteRefs.forEach(({ pixi: sprite, state }) => {
        const p = getProfile(state)
        const targetHeight = h * SPRITE_HEIGHT_RATIO
        const baseScale = targetHeight / sprite.texture.height
        sprite.y = h - 20 + Math.sin(t * p.bobFreq) * p.bobAmp
        sprite.rotation = Math.sin(t * p.bobFreq * 0.6) * (p.sway * Math.PI / 180)
        const s = 1.0 + p.breathe * Math.sin(t * 1.5)
        sprite.scale.set(baseScale * s)
      })
    }
  }

  return <div ref={containerRef} className="absolute inset-0" style={{ zIndex: 1, pointerEvents: 'none' }} />
}
