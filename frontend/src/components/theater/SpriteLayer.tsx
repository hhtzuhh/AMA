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
  // Always hold the latest props so init callback can read them after async gap
  const latestProps = useRef({ spriteUrl, state, width, height })
  latestProps.current = { spriteUrl, state, width, height }

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
      // Init finished — load whatever sprite is current now
      loadSprite(latestProps.current.spriteUrl, latestProps.current.state,
                 latestProps.current.width, latestProps.current.height)
    })

    return () => {
      destroyed = true
      if (appRef.current) {
        appRef.current.destroy(true, { children: true })
        appRef.current = null
      }
      spriteRef.current = null
    }
  }, [])

  // Resize canvas when container changes
  useEffect(() => {
    const app = appRef.current
    if (!app || !app.renderer) return
    app.renderer.resize(width, height)
  }, [width, height])

  // Load sprite texture when URL or state changes (app already ready path)
  useEffect(() => {
    if (!appRef.current?.stage) return
    loadSprite(spriteUrl, state, width, height)
  }, [spriteUrl, state, width, height])

  function loadSprite(url: string, st: string, w: number, h: number) {
    const app = appRef.current
    if (!app?.stage) return

    async function run() {
      const application = appRef.current!
      if (spriteRef.current) {
        application.stage.removeChild(spriteRef.current)
        spriteRef.current.destroy()
        spriteRef.current = null
      }

      try {
        const texture = await PIXI.Assets.load(url)
        if (!appRef.current) return  // unmounted during load
        const sprite = new PIXI.Sprite(texture)
        spriteRef.current = sprite

        const targetHeight = h * SPRITE_HEIGHT_RATIO
        const scale = targetHeight / sprite.texture.height
        sprite.scale.set(scale)
        sprite.anchor.set(0.5, 1)
        sprite.x = w / 2
        sprite.y = h - 20

        application.stage.addChild(sprite)
        application.ticker.remove(animateSprite)
        application.ticker.add(animateSprite)
      } catch {
        console.warn('Sprite not found:', url)
      }
    }

    function animateSprite() {
      const sprite = spriteRef.current
      if (!sprite) return
      const t = performance.now() / 1000
      const p = getProfile(st)
      const targetHeight = h * SPRITE_HEIGHT_RATIO
      const baseScale = targetHeight / sprite.texture.height

      sprite.x = w / 2
      sprite.y = h - 20 + Math.sin(t * p.bobFreq) * p.bobAmp
      sprite.rotation = Math.sin(t * p.bobFreq * 0.6) * (p.sway * Math.PI / 180)
      const s = 1.0 + p.breathe * Math.sin(t * 1.5)
      sprite.scale.set(baseScale * s)
    }

    run()
  }

  return <div ref={containerRef} className="absolute inset-0" style={{ zIndex: 1, pointerEvents: 'none' }} />
}
