import React, { useCallback, useMemo } from 'react'
import MediaSection from '../common/MediaSection'
import OptionTabs from '../common/OptionTabs'
import sectionStyles from '../common/MediaSection.module.css'
import MediaCard from '../common/MediaCard'
import MangaPopup from './MangaPopup'
import { useInfiniteMangaBrowse, mangaCoverSrc } from '../../hooks/useManga'
import { useToggleMangaBookmark, mangaLibraryId } from '../../hooks/useMangaLibrary'
import { useMangaPopup } from '../../hooks/useMangaPopup'
import { useProviders } from '../../hooks/useProviders'
import { useMatureConsent } from '../../hooks/useMatureConsent'
import { useLocalStorage } from '../../hooks/useLocalStorage'
import { isMangaAdult, mangaNameVariants } from '../../lib/manga'

const TRENDING_SORTS = [
  { value: 'popular', label: 'Popular' },
  { value: 'followed', label: 'Most Followed' },
  { value: 'rating', label: 'Top Rated' },
]

function useDefaultMangaProvider(): string {
  const { options } = useProviders()
  return useMemo(
    () => options.filter((o) => o.kind === 'manga').map((o) => o.value)[0] ?? '',
    [options]
  )
}

const MangaDiscoverRail: React.FC<{
  title: string
  eyebrow: string
  provider: string
  sort: string
  mature: boolean
  headerActions?: React.ReactNode
}> = ({ title, eyebrow, provider, sort, mature, headerActions }) => {
  const { toggle, bookmarkedIds } = useToggleMangaBookmark()
  const { popup, openPopup, scheduleClose, cancelClose, closePopup } = useMangaPopup()

  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteMangaBrowse({
      provider,
      query: '',
      sort,
      status: '',
      type: '',
      rating: mature ? 'safe,suggestive,erotica,pornographic' : 'safe',
      mature,
    })
  const items = useMemo(() => data?.pages.flatMap((page) => page.items) ?? [], [data])

  const handleReachThreshold = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage && !isLoading) {
      fetchNextPage()
    }
  }, [hasNextPage, isFetchingNextPage, isLoading, fetchNextPage])

  if (!provider) return null

  return (
    <>
      <MediaSection
        title={title}
        eyebrow={eyebrow}
        loading={isLoading}
        carousel
        itemCount={items.length}
        headerActions={headerActions}
        onReachThreshold={handleReachThreshold}
        isFetchingNextPage={isFetchingNextPage}
        loadingSkeleton={<div className="skeleton" style={{ aspectRatio: '3 / 4' }} />}
        skeletonCount={7}
      >
        {items.map((item) => {
          const libId = mangaLibraryId(item.provider, item.id)
          return (
            <MediaCard
              key={`${item.provider}-${item.id}`}
              item={{
                id: libId,
                title: item.title,
                ...mangaNameVariants(item),
                thumbnail: mangaCoverSrc(item.provider, item.cover),
                typeBadge: item.type || undefined,
                chapterBadge: item.latestChapter ? `Ch. ${item.latestChapter}` : null,
                isAdult: isMangaAdult(item),
              }}
              linkTo={`/manga/${item.provider}/${encodeURIComponent(item.id)}`}
              hoverIcon="info"
              showInfoButton
              display={{
                elements: {
                  poster: { typeBadge: true, chapterBadge: true, adultBadge: true },
                  info: { title: true, mobileBadges: true, progress: false, meta: false },
                },
              }}
              onOpenDetails={(rect) =>
                openPopup(rect, {
                  provider: item.provider,
                  mangaId: item.id,
                  title: item.title,
                  altTitle: item.altTitle,
                  cover: item.cover,
                  contentRating: item.contentRating,
                  readTarget: `/manga/${item.provider}/${encodeURIComponent(item.id)}`,
                  mature,
                })
              }
              onPopupHoverIntent={(inside) => (inside ? cancelClose() : scheduleClose())}
              rawThumbnail
            />
          )
        })}
      </MediaSection>
      {popup && (
        <MangaPopup
          data={popup.data}
          anchorRect={popup.rect}
          bookmarked={bookmarkedIds.has(mangaLibraryId(popup.data.provider, popup.data.mangaId))}
          onToggleBookmark={() =>
            toggle({
              id: popup.data.mangaId,
              provider: popup.data.provider,
              title: popup.data.title,
              cover: popup.data.cover,
              altTitle: popup.data.altTitle ?? undefined,
              contentRating: popup.data.contentRating,
            })
          }
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          onRequestClose={closePopup}
        />
      )}
    </>
  )
}

const MangaDiscover: React.FC = () => {
  const provider = useDefaultMangaProvider()
  const { hasConsent } = useMatureConsent()
  const [discoverTab, setDiscoverTab] = useLocalStorage<'latest' | 'trending'>(
    'manga_discover_tab',
    'latest'
  )
  const [trendingSort, setTrendingSort] = useLocalStorage<string>('manga_trending_sort', 'popular')

  if (!provider) return null

  return (
    <>
      <OptionTabs
        ariaLabel="Discover manga"
        options={[
          { value: 'latest' as const, label: 'Latest Releases' },
          { value: 'trending' as const, label: 'Trending' },
        ]}
        value={discoverTab}
        onChange={setDiscoverTab}
      />
      {discoverTab === 'latest' ? (
        <MangaDiscoverRail
          title="Latest Releases"
          eyebrow="Fresh chapters"
          provider={provider}
          sort="latest"
          mature={hasConsent}
        />
      ) : (
        <MangaDiscoverRail
          title="Trending"
          eyebrow="Discover"
          provider={provider}
          sort={trendingSort}
          mature={hasConsent}
          headerActions={
            <select
              className={sectionStyles['header-select']}
              value={trendingSort}
              onChange={(e) => setTrendingSort(e.currentTarget.value)}
              aria-label="Trending sort"
            >
              {TRENDING_SORTS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          }
        />
      )}
    </>
  )
}

export default MangaDiscover
