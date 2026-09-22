import React, { useMemo } from 'react'
import { useNavigate } from 'react-router'
import SpotlightBannerShell, { type SpotlightSlide } from '../common/SpotlightBanner'
import type { AsmrWork } from '../../hooks/useAsmr'
import { asmrWorkId } from '../../lib/asmr'
import localStyles from './AsmrSpotlightBanner.module.css'

interface AsmrSpotlightBannerProps {
  works: AsmrWork[]
}

function trackCountFor(work: AsmrWork): number | null {
  const sub = work.availableEpisodes?.sub
  if (typeof sub === 'number' && sub > 0) return sub
  const detailSub = work.availableEpisodesDetail?.sub
  const detailDub = work.availableEpisodesDetail?.dub
  const n =
    (Array.isArray(detailSub) ? detailSub.length : 0) +
    (Array.isArray(detailDub) ? detailDub.length : 0)
  return n > 0 ? n : null
}

const AsmrSpotlightBanner: React.FC<AsmrSpotlightBannerProps> = ({ works }) => {
  const navigate = useNavigate()

  const slides = useMemo<SpotlightSlide[]>(
    () =>
      works.slice(0, 6).map((work, index) => {
        const rj = asmrWorkId(work)
        const target = `/asmr/${encodeURIComponent(rj)}`
        const trackCount = trackCountFor(work)
        return {
          key: rj || work._id || String(index),
          bannerSrc: work.thumbnail || '',
          posterSrc: work.thumbnail,
          posterAlt: work.name,
          title: work.name,
          detailTo: target,
          metaItems: [
            work.rating ? work.rating.toUpperCase() : undefined,
            trackCount ? `${trackCount} track${trackCount === 1 ? '' : 's'}` : undefined,
          ].filter((item): item is string => Boolean(item)),
          tags: [],
          synopsis: work.description?.slice(0, 160) || '',
          primaryLabel: 'Listen Now',
          primaryIcon: 'play',
          onPrimary: () => navigate(target),
          onDetails: () => navigate(target),
        }
      }),
    [works, navigate]
  )

  return <SpotlightBannerShell slides={slides} posterClassName={localStyles.posterLandscape} />
}

export default AsmrSpotlightBanner
