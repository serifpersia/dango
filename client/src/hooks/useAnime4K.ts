import { useEffect, useRef, useState, useCallback } from 'react'
import type { ModeA, ModeB, ModeC, ModeAA } from 'anime4k-webgpu-async'

export type Anime4KProfile = 'low' | 'balanced' | 'high' | 'denoise'

type Preset = 'ModeA' | 'ModeB' | 'ModeC' | 'ModeAA'
type Pipeline = ModeA | ModeB | ModeC | ModeAA

interface UseAnime4KOptions {
  videoRef: { current: HTMLVideoElement | null }
  canvasRef: { current: HTMLCanvasElement | null }
  profile?: Anime4KProfile
}

// Presets only run their CNN upscale stages when target > 1.2x native
// (strict `>` in the lib), so scales must stay clearly above 1.2.
const PROFILE_SCALES: Record<Anime4KProfile, { sd: number; hd: number; fhd: number }> = {
  low: { sd: 1.5, hd: 1.3, fhd: 1.25 },
  balanced: { sd: 2, hd: 1.5, fhd: 1.25 },
  high: { sd: 2.5, hd: 2, fhd: 1.5 },
  denoise: { sd: 1.5, hd: 1.5, fhd: 1.5 },
}

const PROFILE_PRESETS: Record<Anime4KProfile, Preset> = {
  low: 'ModeB',
  balanced: 'ModeA',
  high: 'ModeAA',
  denoise: 'ModeC',
}

const MAX_CONSECUTIVE_ERRORS = 5
const METADATA_TIMEOUT_MS = 15000

export default function useAnime4K({
  videoRef,
  canvasRef,
  profile = 'balanced',
}: UseAnime4KOptions) {
  const [isWebGPUSupported, setIsWebGPUSupported] = useState(false)
  const [isEnabled, setIsEnabled] = useState(false)
  const [isInitializing, setIsInitializing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rebuildKey, setRebuildKey] = useState(0)
  const generationRef = useRef(0)
  const deviceRef = useRef<GPUDevice | null>(null)
  const contextRef = useRef<GPUCanvasContext | null>(null)
  const pipelineRef = useRef<Pipeline | null>(null)
  const inputTextureRef = useRef<GPUTexture | null>(null)
  const outputTextureRef = useRef<GPUTexture | null>(null)
  const renderPipelineRef = useRef<GPURenderPipeline | null>(null)
  const samplerRef = useRef<GPUSampler | null>(null)
  const bindGroupLayoutRef = useRef<GPUBindGroupLayout | null>(null)
  const rafRef = useRef<number | null>(null)
  const inFlightRef = useRef(false)
  const lastFrameRef = useRef(-1)
  const errorCountRef = useRef(0)

  useEffect(() => {
    async function checkWebGPU() {
      if (typeof navigator === 'undefined' || !navigator.gpu) {
        setIsWebGPUSupported(false)
        return
      }
      try {
        const adapter = await navigator.gpu.requestAdapter()
        setIsWebGPUSupported(!!adapter)
      } catch {
        setIsWebGPUSupported(false)
      }
    }
    checkWebGPU()
  }, [])

  useEffect(() => {
    if (!isEnabled || !isWebGPUSupported) return

    let cancelled = false
    const generation = ++generationRef.current

    function cancelScheduled() {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }

    async function setup() {
      let video = videoRef.current
      const canvas = canvasRef.current
      if (!video || !canvas) return
      if (generationRef.current !== generation) return

      const deadline = performance.now() + METADATA_TIMEOUT_MS
      while ((!video || video.videoWidth === 0) && performance.now() < deadline) {
        await new Promise((r) => requestAnimationFrame(r))
        if (cancelled || generationRef.current !== generation) return
        video = videoRef.current
      }
      if (!video || video.videoWidth === 0) {
        if (!cancelled && generationRef.current === generation) {
          setError('Timed out waiting for video metadata')
          setIsInitializing(false)
          setIsEnabled(false)
        }
        return
      }

      const width = video.videoWidth
      const height = video.videoHeight
      const sourceMax = Math.max(width, height)
      const displayWidth = window.innerWidth
      const displayHeight = window.innerHeight
      const displayMax = Math.max(displayWidth, displayHeight)
      const scaleToMatch = sourceMax < displayMax ? displayMax / sourceMax : 1
      const scales = PROFILE_SCALES[profile]
      const baseScale =
        sourceMax <= 480
          ? scales.sd
          : sourceMax <= 720
            ? scales.hd
            : sourceMax <= 1080
              ? scales.fhd
              : 1
      const targetScale = Math.min(baseScale, scaleToMatch)
      canvas.width = Math.round(width * targetScale)
      canvas.height = Math.round(height * targetScale)

      setIsInitializing(true)
      setError(null)
      errorCountRef.current = 0
      lastFrameRef.current = -1
      inFlightRef.current = false

      try {
        const { ModeA, ModeB, ModeC, ModeAA } = await import('anime4k-webgpu-async')
        if (!navigator.gpu) throw new Error('WebGPU not available')
        const adapter = await navigator.gpu.requestAdapter()
        if (!adapter) throw new Error('No GPU adapter found')
        const device = await adapter.requestDevice()
        if (!device) throw new Error('Failed to get GPU device')

        const context = canvas.getContext('webgpu')
        if (!context) throw new Error('Failed to get WebGPU context')

        const format = navigator.gpu.getPreferredCanvasFormat()
        context.configure({
          device,
          format,
          alphaMode: 'premultiplied',
        })

        const inputTexture = device.createTexture({
          size: [width, height],
          format: 'rgba16float',
          usage:
            GPUTextureUsage.TEXTURE_BINDING |
            GPUTextureUsage.COPY_DST |
            GPUTextureUsage.RENDER_ATTACHMENT,
        })

        const preset = PROFILE_PRESETS[profile]
        const targetWidth = Math.round(width * targetScale)
        const targetHeight = Math.round(height * targetScale)
        const pipeline = (() => {
          switch (preset) {
            case 'ModeB':
              return new ModeB({
                device,
                inputTexture,
                nativeDimensions: { width, height },
                targetDimensions: { width: targetWidth, height: targetHeight },
              })
            case 'ModeC':
              return new ModeC({
                device,
                inputTexture,
                nativeDimensions: { width, height },
                targetDimensions: { width: targetWidth, height: targetHeight },
              })
            case 'ModeAA':
              return new ModeAA({
                device,
                inputTexture,
                nativeDimensions: { width, height },
                targetDimensions: { width: targetWidth, height: targetHeight },
              })
            case 'ModeA':
            default:
              return new ModeA({
                device,
                inputTexture,
                nativeDimensions: { width, height },
                targetDimensions: { width: targetWidth, height: targetHeight },
              })
          }
        })()

        const outputTexture = pipeline.getOutputTexture()

        const sampler = device.createSampler({
          magFilter: 'linear',
          minFilter: 'linear',
        })

        const shaderModule = device.createShaderModule({
          code: `
            @group(0) @binding(0) var tex: texture_2d<f32>;
            @group(0) @binding(1) var samp: sampler;
            struct VertexOutput {
              @builtin(position) pos: vec4f,
              @location(0) uv: vec2f,
            }
            @vertex
            fn vs(@builtin(vertex_index) idx: u32) -> VertexOutput {
              var positions = array<vec2f, 6>(
                vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
                vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0)
              );
              var uvs = array<vec2f, 6>(
                vec2f(0.0, 1.0), vec2f(1.0, 1.0), vec2f(0.0, 0.0),
                vec2f(0.0, 0.0), vec2f(1.0, 1.0), vec2f(1.0, 0.0)
              );
              var out: VertexOutput;
              out.pos = vec4f(positions[idx], 0.0, 1.0);
              out.uv = uvs[idx];
              return out;
            }
            @fragment
            fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
              return textureSample(tex, samp, uv);
            }
          `,
        })

        const bindGroupLayout = device.createBindGroupLayout({
          entries: [
            { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
            { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
          ],
        })

        const renderPipeline = device.createRenderPipeline({
          layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
          vertex: { module: shaderModule, entryPoint: 'vs' },
          fragment: { module: shaderModule, entryPoint: 'fs', targets: [{ format }] },
          primitive: { topology: 'triangle-list' },
        })

        const bindGroup = device.createBindGroup({
          layout: bindGroupLayout,
          entries: [
            { binding: 0, resource: outputTexture.createView() },
            { binding: 1, resource: sampler },
          ],
        })

        if (generationRef.current !== generation) {
          inputTexture.destroy()
          device.destroy()
          return
        }

        deviceRef.current = device
        contextRef.current = context
        pipelineRef.current = pipeline
        inputTextureRef.current = inputTexture
        outputTextureRef.current = outputTexture
        renderPipelineRef.current = renderPipeline
        samplerRef.current = sampler
        bindGroupLayoutRef.current = bindGroupLayout

        setIsInitializing(false)

        function schedule() {
          if (cancelled || generationRef.current !== generation) return
          cancelScheduled()
          rafRef.current = requestAnimationFrame(() => {
            void frame()
          })
        }

        async function frame() {
          if (cancelled || generationRef.current !== generation) return
          const current = videoRef.current
          if (!current || current.videoWidth === 0) {
            schedule()
            return
          }
          if (current !== video || current.videoWidth !== width || current.videoHeight !== height) {
            setRebuildKey((k) => k + 1)
            return
          }
          const presented = current.getVideoPlaybackQuality().totalVideoFrames
          if (
            current.paused ||
            current.ended ||
            document.hidden ||
            current.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
            presented === lastFrameRef.current
          ) {
            schedule()
            return
          }
          if (inFlightRef.current) {
            schedule()
            return
          }
          inFlightRef.current = true
          try {
            const bitmap = await createImageBitmap(current)
            device.queue.copyExternalImageToTexture({ source: bitmap }, { texture: inputTexture }, [
              width,
              height,
            ])
            bitmap.close()

            const encoder = device.createCommandEncoder()
            await pipeline.pass(encoder)

            const pass = encoder.beginRenderPass({
              colorAttachments: [
                {
                  view: context.getCurrentTexture().createView(),
                  clearValue: { r: 0, g: 0, b: 0, a: 1 },
                  loadOp: 'clear',
                  storeOp: 'store',
                },
              ],
            })
            pass.setPipeline(renderPipeline)
            pass.setBindGroup(0, bindGroup)
            pass.draw(6)
            pass.end()

            device.queue.submit([encoder.finish()])
            lastFrameRef.current = presented
            errorCountRef.current = 0
            device.queue.onSubmittedWorkDone().then(() => {
              if (generationRef.current === generation) inFlightRef.current = false
            })
          } catch (err) {
            inFlightRef.current = false
            errorCountRef.current += 1
            if (
              errorCountRef.current >= MAX_CONSECUTIVE_ERRORS &&
              !cancelled &&
              generationRef.current === generation
            ) {
              console.error(err)
              setError(err instanceof Error ? err.message : 'Render error')
              setIsEnabled(false)
              return
            }
          }

          schedule()
        }

        schedule()
      } catch (err) {
        if (!cancelled && generationRef.current === generation) {
          setError(err instanceof Error ? err.message : 'Failed to initialize upscaler')
          setIsInitializing(false)
          setIsEnabled(false)
        }
      }
    }

    setup()

    return () => {
      cancelled = true
      generationRef.current += 1
      cancelScheduled()
      if (inputTextureRef.current) {
        inputTextureRef.current.destroy()
        inputTextureRef.current = null
      }
      if (outputTextureRef.current) {
        outputTextureRef.current.destroy()
        outputTextureRef.current = null
      }
      if (deviceRef.current) {
        deviceRef.current.destroy()
        deviceRef.current = null
      }
      pipelineRef.current = null
      renderPipelineRef.current = null
      samplerRef.current = null
      bindGroupLayoutRef.current = null
      contextRef.current = null
      inFlightRef.current = false
    }
  }, [isEnabled, isWebGPUSupported, videoRef, canvasRef, profile, rebuildKey])

  const toggle = useCallback(() => {
    setIsEnabled((prev) => !prev)
  }, [])

  return {
    isWebGPUSupported,
    isEnabled,
    isInitializing,
    error,
    toggle,
  }
}
