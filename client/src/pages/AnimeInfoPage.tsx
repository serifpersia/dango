import { lazy, Suspense } from 'react'
import TopProgressBar from '../components/common/TopProgressBar'

const AnimeInfo = lazy(() => import('../components/anime/AnimeInfo'))

export default function AnimeInfoPage() {
  return (
    <Suspense fallback={<TopProgressBar />}>
      <AnimeInfo />
    </Suspense>
  )
}
