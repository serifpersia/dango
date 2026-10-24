import { useEffect, useState } from 'react'

export default function ProfileAvatar({ image, name }: { image?: string | null; name: string }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [image])
  return image && !failed ? (
    <img
      src={image}
      alt={name}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      style={{
        width: '100%',
        height: '100%',
        maxWidth: 72,
        maxHeight: 72,
        aspectRatio: '1',
        objectFit: 'cover',
        borderRadius: '50%',
      }}
    />
  ) : (
    <svg
      viewBox="0 0 24 24"
      role="img"
      aria-label={name}
      style={{ width: '100%', height: '100%', maxWidth: 72, maxHeight: 72, aspectRatio: '1' }}
      fill="currentColor"
    >
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21v-2a8 8 0 0 1 16 0v2z" />
    </svg>
  )
}
