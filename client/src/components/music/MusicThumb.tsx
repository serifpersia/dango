import { useEffect, useState } from 'react'
import Icon from '../common/Icon'
import radioStyles from '../radio/Radio.module.css'
import {
  forgetThumb,
  musicThumbCandidates,
  rememberThumb,
} from '../../lib/musicThumb'

interface Props {
  id: string
  thumbnails?: { url: string }[]
}

export default function MusicThumb({ id, thumbnails }: Props) {
  const [step, setStep] = useState(0)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setStep(0)
    setFailed(false)
  }, [id])

  const candidates = musicThumbCandidates(id, thumbnails)
  const src = candidates[step]

  if (failed || !src) {
    return (
      <span className={radioStyles.stationThumbPlaceholder}>
        <Icon name="headphones" />
      </span>
    )
  }

  return (
    <img
      src={src}
      alt=""
      className={radioStyles.stationThumb}
      loading="lazy"
      decoding="async"
      onLoad={() => rememberThumb(id, src)}
      onError={() => {
        forgetThumb(src)
        if (step + 1 < candidates.length) setStep(step + 1)
        else setFailed(true)
      }}
    />
  )
}
