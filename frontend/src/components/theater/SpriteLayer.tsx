import { useEffect, useRef } from 'react'
import * as PIXI from 'pixi.js'
import { getProfile } from '../../data/animationProfiles'

interface Props {
  spriteUrl: string
  state: string
  width: number
  height: number
}

const SPRITE_HEIGHT_RATIO = 0.6

export default function SpriteLayer({ spriteUrl, state, width, height }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const appRef = useRef<PIXI.Application | null>(null)
  const spriteRef = useRef<PIXI.Sprite | null>(null)

  // Initialize PixiJS app once
  useEffect(() => {
    if (!containerRef.current) return

    const app = new PIXI.Application()
    appRef.current = app

    app.init({
      width,
      height,
      backgroundAlpha: 0,
      antialias: true,
    }).then(() => {
      containerRef.current?.appendChild(app.canvas)
      app.canvas.style.position = 'absolute'
      app.canvas.style.inset = '0'
      app.canvas.style.zIndex = '1'
      app.canvas.style.pointerEvents = 'none'
    })

    return () => {
      app.destroy(true, { children: true })
      appRef.current = null
      spriteRef.current = null
    }
  }, [])

  // Resize canvas when container changes
  useEffect(() => {
    const app = appRef.current
    if (!app || !app.renderer) return
    app.renderer.resize(width, height)
  }, [width, height])

  // Load sprite texture when URL changes
  useEffect(() => {
    const app = appRef.current
    if (!app || !app.stage) return

    async function loadSprite() {
      const application = appRef.current!
      // Remove old sprite
      if (spriteRef.current) {
        application.stage.removeChild(spriteRef.current)
        spriteRef.current.destroy()
        spriteRef.current = null
      }

      try {
        const texture = await PIXI.Assets.load(spriteUrl)
        const sprite = new PIXI.Sprite(texture)
        spriteRef.current = sprite

        const targetHeight = height * SPRITE_HEIGHT_RATIO
        const scale = targetHeight / sprite.texture.height
        sprite.scale.set(scale)

        // Anchor at center-bottom
        sprite.anchor.set(0.5, 1)
        sprite.x = width / 2
        sprite.y = height - 20

        application.stage.addChild(sprite)

        // Animation loop — port from pygame ANIMATION_PROFILES
        application.ticker.remove(animateSprite)
        application.ticker.add(animateSprite)
      } catch {
        console.warn('Sprite not found:', spriteUrl)
      }
    }

    function animateSprite() {
      const sprite = spriteRef.current
      if (!sprite) return
      const t = performance.now() / 1000
      const p = getProfile(state)
      const targetHeight = height * SPRITE_HEIGHT_RATIO
      const baseScale = targetHeight / sprite.texture.height

      sprite.x = width / 2
      sprite.y = height - 20 + Math.sin(t * p.bobFreq) * p.bobAmp
      sprite.rotation = Math.sin(t * p.bobFreq * 0.6) * (p.sway * Math.PI / 180)
      const s = 1.0 + p.breathe * Math.sin(t * 1.5)
      sprite.scale.set(baseScale * s)
    }

    loadSprite()
  }, [spriteUrl, state, width, height])

  return <div ref={containerRef} className="absolute inset-0" style={{ zIndex: 1, pointerEvents: 'none' }} />
}
