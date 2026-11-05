import { useEffect, useState } from 'react'

export default function ProfileAvatar({
  image,
  name,
  size = 72,
  radius = '50%',
}: {
  image?: string | null
  name: string
  size?: number | string
  radius?: string
}) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [image])
  const style = {
    width: '100%',
    height: '100%',
    maxWidth: size,
    maxHeight: size,
    aspectRatio: '1',
    objectFit: 'cover' as const,
    borderRadius: radius,
  }
  return image && !failed ? (
    <img
      src={image}
      alt={name}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      style={style}
    />
  ) : (
    <svg viewBox="0 0 24 24" role="img" aria-label={name} style={style} fill="currentColor">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21v-2a8 8 0 0 1 16 0v2z" />
    </svg>
  )
}
