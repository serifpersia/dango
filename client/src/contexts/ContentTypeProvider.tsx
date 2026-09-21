import React, { useMemo } from 'react'
import { ContentTypeContext, type ContentType } from './ContentTypeContext'
import { useLocalStorage } from '../hooks/useLocalStorage'

export const ContentTypeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [contentType, setContentType] = useLocalStorage<ContentType>('dango_content_type', 'anime')

  const value = useMemo(() => ({ contentType, setContentType }), [contentType, setContentType])

  return <ContentTypeContext.Provider value={value}>{children}</ContentTypeContext.Provider>
}
