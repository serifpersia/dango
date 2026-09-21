import { createContext, useContext } from 'react'

export type ContentType = 'anime' | 'manga' | 'tv' | 'asmr'

export type ContentTypeContextType = {
  contentType: ContentType
  setContentType: (next: ContentType) => void
}

export const ContentTypeContext = createContext<ContentTypeContextType | undefined>(undefined)

export const useContentType = (): ContentTypeContextType => {
  const context = useContext(ContentTypeContext)
  if (context === undefined) {
    throw new Error('useContentType must be used within a ContentTypeProvider')
  }
  return context
}
