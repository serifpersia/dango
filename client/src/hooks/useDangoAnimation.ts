import { useEffect } from 'react'
import { useSetting } from './useSettings'
import { useLowEndMode } from '../contexts/LowEndModeContext'

const FACE = 'data-dango-face'
const HOVER = 'data-dango-hover'
const CHEER = 'data-dango-cheer'

const bars = () => document.querySelectorAll<HTMLElement>('[data-dango-origin]')
const slots = () => document.querySelectorAll<HTMLElement>('[data-dango-slot]')
const allEyes = () => document.querySelectorAll<SVGGElement>('[data-dango-eye]')

export const clamp = (n: number) => Math.max(-1, Math.min(1, n))

export const gazeAt = (clientX: number, clientY: number, rect: DOMRect) => {
  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2
  return {
    x: clamp((clientX - cx) / 180),
    y: clamp((clientY - cy) / 120),
  }
}

const hitTest = (clientX: number, clientY: number, bar: HTMLElement, pad = 0) => {
  const els = Array.from(bar.querySelectorAll<HTMLElement>('[data-dango-slot]'))
  for (const el of els) {
    const r = el.getBoundingClientRect()
    if (
      clientX >= r.left - pad &&
      clientX <= r.right + pad &&
      clientY >= r.top - pad &&
      clientY <= r.bottom + pad
    ) {
      return Number(el.getAttribute('data-dango-slot'))
    }
  }
  return -1
}

export const useDangoAlive = () => {
  const { data: gazeSetting } = useSetting('dangoGaze')
  const { lowEndMode } = useLowEndMode()
  return gazeSetting !== 'false' && gazeSetting !== false && !lowEndMode
}

export const startDangoAnimation = () => {
  if (typeof window === 'undefined') return () => {}
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return () => {}

  const resting: string[] = []
  const look: { x: number; y: number; wx: number; wy: number; attn: number; attnT: number }[] = []
  let hovered = -1
  let petting = -1
  let asleep = false
  let turn = -1
  let px = window.innerWidth / 2
  let py = window.innerHeight / 2
  let raf = 0
  let idleTimer = 0
  let settleTimer = 0
  const timers: number[] = []

  const sync = () => {
    const n = slots().length
    while (resting.length < n) resting.push('normal')
    while (look.length < n) look.push({ x: 0, y: 0, wx: 0, wy: 0, attn: 1, attnT: 1 })
    if (resting.length > n) resting.length = n
    if (look.length > n) look.length = n
  }

  const later = (fn: () => void, ms: number) => {
    const id = window.setTimeout(() => {
      const i = timers.indexOf(id)
      if (i >= 0) timers.splice(i, 1)
      fn()
    }, ms)
    timers.push(id)
  }

  const setCheer = (index: number, on: boolean) => {
    slots().forEach((el) => {
      if (Number(el.getAttribute('data-dango-slot')) !== index) return
      if (on) el.setAttribute(CHEER, '')
      else el.removeAttribute(CHEER)
    })
  }

  const paint = () => {
    sync()
    slots().forEach((el) => {
      const i = Number(el.getAttribute('data-dango-slot'))
      el.setAttribute(FACE, petting === i ? 'pet' : asleep ? 'sleep' : resting[i] || 'normal')
      if (hovered === i) el.setAttribute(HOVER, '')
      else el.removeAttribute(HOVER)
    })
  }

  const setPetting = (index: number) => {
    if (index === petting) return
    if (petting >= 0) {
      const prev = petting
      later(() => {
        if (petting !== prev) setCheer(prev, false)
      }, 320)
    }
    petting = index
    if (index >= 0) setCheer(index, true)
  }

  const dropPetting = () => {
    window.clearTimeout(settleTimer)
    setPetting(-1)
  }

  const sleep = () => {
    asleep = true
    sync()
    for (let i = 0; i < resting.length; i++) resting[i] = 'sleep'
    look.forEach((l) => {
      l.attnT = 0
      l.wx = 0
      l.wy = 0
    })
    dropPetting()
    paint()
  }

  const wake = () => {
    if (!asleep) return
    asleep = false
    sync()
    for (let i = 0; i < resting.length; i++) resting[i] = 'sleep'
    paint()
    resting.forEach((_, i) => {
      later(() => {
        if (asleep) return
        resting[i] = 'normal'
        const l = look[i]
        if (l) l.attnT = 1
        paint()
      }, i * 220)
    })
  }

  const armIdle = () => {
    window.clearTimeout(idleTimer)
    idleTimer = window.setTimeout(sleep, 6000)
  }

  const armSettle = () => {
    window.clearTimeout(settleTimer)
    settleTimer = window.setTimeout(() => {
      setPetting(-1)
      paint()
    }, 420)
  }

  const shuffle = () => {
    sync()
    if (!asleep && resting.length) {
      turn = (turn + 1) % resting.length
      resting[turn] = resting[turn] === 'normal' ? 'squint' : 'normal'
      look.forEach((l, i) => {
        if (i === petting) {
          l.attnT = 1
          l.wx = 0
          l.wy = 0
          return
        }
        const r = Math.random()
        if (r < 0.12) {
          l.attnT = 0.2
          l.wx = (Math.random() - 0.5) * 1.1
          l.wy = (Math.random() - 0.5) * 0.7
          later(
            () => {
              if (petting === i || asleep) return
              l.attnT = 1
            },
            700 + Math.random() * 700
          )
        } else if (r < 0.2) {
          l.attnT = 0.55
          l.wx = (Math.random() - 0.5) * 0.8
          l.wy = (Math.random() - 0.5) * 0.5
          later(
            () => {
              if (petting === i || asleep) return
              l.attnT = 1
            },
            500 + Math.random() * 600
          )
        } else {
          l.attnT = 1
          l.wx = 0
          l.wy = 0
        }
      })
      paint()
    } else if (asleep) {
      for (let i = 0; i < resting.length; i++) resting[i] = 'sleep'
    }
    later(shuffle, 3200 + Math.random() * 2400)
  }

  const applyGaze = () => {
    sync()
    allEyes().forEach((el) => {
      const i = Number(el.getAttribute('data-dango-eye'))
      const rect = el.ownerSVGElement?.getBoundingClientRect()
      const { x, y } = rect ? gazeAt(px, py, rect) : { x: 0, y: 0 }
      const l = look[i]
      if (l) {
        l.attn += (l.attnT - l.attn) * 0.08
        const tx = x * l.attn + l.wx * (1 - l.attn)
        const ty = y * l.attn + l.wy * (1 - l.attn)
        l.x += (tx - l.x) * 0.14
        l.y += (ty - l.y) * 0.14
      }
      const gx = l ? l.x : x
      const gy = l ? l.y : y
      el.style.setProperty('--dango-gaze-x', clamp(gx).toFixed(3))
      el.style.setProperty('--dango-gaze-y', clamp(gy).toFixed(3))
    })
  }

  const step = () => {
    let hitBar: HTMLElement | null = null
    bars().forEach((bar) => {
      const rect = bar.getBoundingClientRect()
      if (px >= rect.left && px <= rect.right && py >= rect.top && py <= rect.bottom) hitBar = bar
    })
    const wasHover = hovered
    const wasPet = petting
    const strict = hitBar ? hitTest(px, py, hitBar) : -1
    const loose = strict >= 0 ? strict : hitBar ? hitTest(px, py, hitBar, 8) : -1
    hovered = strict
    if (loose >= 0) {
      setPetting(loose)
      armSettle()
    } else {
      dropPetting()
    }
    if (wasHover !== hovered || wasPet !== petting) paint()
    if (asleep) wake()
    armIdle()
  }

  const tick = () => {
    raf = window.requestAnimationFrame(tick)
    applyGaze()
  }

  const onMove = (e: PointerEvent) => {
    px = e.clientX
    py = e.clientY
    step()
  }

  const onOut = (e: PointerEvent) => {
    if (e.relatedTarget) return
    hovered = -1
    dropPetting()
    paint()
    armIdle()
  }

  paint()
  armIdle()
  later(shuffle, 3200)
  raf = window.requestAnimationFrame(tick)
  window.addEventListener('pointermove', onMove, { passive: true })
  window.addEventListener('pointerout', onOut)

  return () => {
    window.cancelAnimationFrame(raf)
    window.clearTimeout(idleTimer)
    window.clearTimeout(settleTimer)
    timers.forEach(window.clearTimeout)
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerout', onOut)
    allEyes().forEach((el) => {
      el.style.setProperty('--dango-gaze-x', '0')
      el.style.setProperty('--dango-gaze-y', '0')
    })
    slots().forEach((el) => {
      el.setAttribute(FACE, 'normal')
      el.removeAttribute(HOVER)
      el.removeAttribute(CHEER)
    })
  }
}

export const useDangoAnimation = () => {
  const alive = useDangoAlive()

  useEffect(() => {
    if (!alive) return
    return startDangoAnimation()
  }, [alive])
}
