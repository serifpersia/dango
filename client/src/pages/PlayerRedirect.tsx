import { Navigate, useParams } from 'react-router'

// Legacy `/player/:id` links redirect to the canonical `/watch` routes.
export default function PlayerRedirect() {
  const { id, episodeNumber } = useParams()
  return <Navigate to={episodeNumber ? `/watch/${id}/${episodeNumber}` : `/watch/${id}`} replace />
}
