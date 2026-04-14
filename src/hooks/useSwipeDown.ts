import { useCallback, useEffect, useRef, useState } from 'react'

interface SwipeDownOptions {
  onSwipeDown: () => void
  enabled?: boolean
  edgeHeight?: number
  threshold?: number
}

interface SwipeDownResult {
  containerRef: React.RefObject<HTMLDivElement | null>
  translateY: number
  isSwiping: boolean
  progress: number // 0-1, for visual indicator
}

const MAX_PULL = 150

export function useSwipeDown({
  onSwipeDown,
  enabled = true,
  edgeHeight = 30,
  threshold = 60,
}: SwipeDownOptions): SwipeDownResult {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [translateY, setTranslateY] = useState(0)
  const [isSwiping, setIsSwiping] = useState(false)

  const startYRef = useRef(0)
  const startTimeRef = useRef(0)
  const lastYRef = useRef(0)
  const swipingRef = useRef(false)
  const firedRef = useRef(false)

  const onSwipeDownRef = useRef(onSwipeDown)
  useEffect(() => {
    onSwipeDownRef.current = onSwipeDown
  }, [onSwipeDown])

  const handleTouchStart = useCallback(
    (e: TouchEvent) => {
      if (firedRef.current) return
      const touch = e.touches[0]
      if (!touch || touch.clientY > edgeHeight) return

      startYRef.current = touch.clientY
      startTimeRef.current = Date.now()
      lastYRef.current = touch.clientY
      swipingRef.current = true
      setIsSwiping(true)
    },
    [edgeHeight]
  )

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!swipingRef.current) return
    if (e.cancelable) e.preventDefault()

    const touch = e.touches[0]
    if (!touch) return
    const deltaY = Math.max(
      0,
      Math.min(MAX_PULL, touch.clientY - startYRef.current)
    )
    setTranslateY(deltaY)
    lastYRef.current = touch.clientY
  }, [])

  const handleTouchEnd = useCallback(() => {
    if (!swipingRef.current) return
    swipingRef.current = false

    const elapsed = Date.now() - startTimeRef.current
    const distance = lastYRef.current - startYRef.current
    const velocity = elapsed > 0 ? (distance / elapsed) * 1000 : 0
    const shouldComplete = distance > threshold || velocity > 400

    if (shouldComplete) {
      firedRef.current = true
      onSwipeDownRef.current()
      // Brief delay before resetting so the visual indicator can show completion
      setTimeout(() => {
        firedRef.current = false
      }, 100)
    }

    setTranslateY(0)
    setIsSwiping(false)
  }, [threshold])

  useEffect(() => {
    if (!enabled) return
    const el = containerRef.current
    if (!el) return

    el.addEventListener('touchstart', handleTouchStart, { passive: true })
    el.addEventListener('touchmove', handleTouchMove, { passive: false })
    el.addEventListener('touchend', handleTouchEnd, { passive: true })

    return () => {
      el.removeEventListener('touchstart', handleTouchStart)
      el.removeEventListener('touchmove', handleTouchMove)
      el.removeEventListener('touchend', handleTouchEnd)
    }
  }, [enabled, handleTouchStart, handleTouchMove, handleTouchEnd])

  const progress = Math.min(1, translateY / threshold)

  return { containerRef, translateY, isSwiping, progress }
}
