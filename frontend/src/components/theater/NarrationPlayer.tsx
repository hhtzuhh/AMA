import { useEffect, useRef } from 'react'

interface Props {
  src: string
  onPlay?: () => void
  onEnd?: () => void
  triggerReplay?: number
}

export default function NarrationPlayer({ src, onPlay, onEnd, triggerReplay }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null)

  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !src) return
    audio.src = src
    audio.load()
    audio.play()
      .then(() => onPlay?.())
      .catch(() => {})
  }, [src])

  useEffect(() => {
    if (triggerReplay && triggerReplay > 0) {
      const audio = audioRef.current
      if (!audio) return
      audio.currentTime = 0
      audio.play().then(() => onPlay?.()).catch(() => {})
    }
  }, [triggerReplay])

  return (
    <audio
      ref={audioRef}
      onPlay={onPlay}
      onEnded={onEnd}
      style={{ display: 'none' }}
    />
  )
}
