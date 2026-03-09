import { useEffect, useRef } from 'react'

interface Props {
  src: string
}

export default function BackgroundLayer({ src }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.src = src
    video.load()
    video.play().catch(() => {})
  }, [src])

  return (
    <video
      ref={videoRef}
      autoPlay
      loop
      muted
      playsInline
      className="absolute inset-0 w-full h-full object-cover"
      style={{ zIndex: 0 }}
    />
  )
}
