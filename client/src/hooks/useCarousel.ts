import { useCallback, useEffect, useRef, useState } from 'react'
import useEmblaCarousel from 'embla-carousel-react'
import type { EmblaCarouselType, EmblaOptionsType } from 'embla-carousel'

interface UseCarouselOptions {
  align?: EmblaOptionsType['align']
  containScroll?: EmblaOptionsType['containScroll']
  scrollFraction?: number
  threshold?: number
  onReachThreshold?: () => void
}

export function useCarousel({
  align = 'start',
  containScroll = 'trimSnaps',
  scrollFraction = 0.8,
  threshold = 0.6,
  onReachThreshold,
}: UseCarouselOptions = {}) {
  const [emblaRef, api] = useEmblaCarousel({ align, containScroll, dragFree: true })
  const [canScroll, setCanScroll] = useState(false)
  const optionsRef = useRef({ scrollFraction, threshold, onReachThreshold })
  const thresholdCrossed = useRef(false)

  useEffect(() => {
    optionsRef.current = { scrollFraction, threshold, onReachThreshold }
  })

  const updateCanScroll = useCallback((instance: EmblaCarouselType) => {
    setCanScroll(instance.canScrollPrev() || instance.canScrollNext())
  }, [])

  useEffect(() => {
    if (!api) return

    const onScroll = () => {
      const progress = api.scrollProgress()
      if (progress >= optionsRef.current.threshold && !thresholdCrossed.current) {
        thresholdCrossed.current = true
        optionsRef.current.onReachThreshold?.()
      } else if (progress < optionsRef.current.threshold) {
        thresholdCrossed.current = false
      }
      updateCanScroll(api)
    }

    api.on('init', onScroll)
    api.on('reInit', onScroll)
    api.on('scroll', onScroll)
    api.on('resize', onScroll)

    return () => {
      api.off('init', onScroll)
      api.off('reInit', onScroll)
      api.off('scroll', onScroll)
      api.off('resize', onScroll)
    }
  }, [api, updateCanScroll])

  const slidesPerView = useCallback((instance: EmblaCarouselType) => {
    const slide = instance.containerNode().firstElementChild as HTMLElement | null
    if (!slide) return 1
    const viewportWidth = instance.rootNode().getBoundingClientRect().width
    const slideWidth = slide.getBoundingClientRect().width
    if (!slideWidth) return 1
    return Math.max(1, Math.round(viewportWidth / slideWidth))
  }, [])

  const stepBy = useCallback(
    (direction: 'left' | 'right', jump = false) => {
      if (!api) return
      const n = Math.max(1, Math.round(slidesPerView(api) * optionsRef.current.scrollFraction))
      const target = api.selectedScrollSnap() + (direction === 'left' ? -n : n)
      api.scrollTo(target, jump)
    },
    [api, slidesPerView]
  )

  const scrollToStart = useCallback(
    (jump = false) => {
      api?.scrollTo(0, jump)
    },
    [api]
  )

  return { emblaRef, api, canScroll, stepBy, scrollToStart }
}
