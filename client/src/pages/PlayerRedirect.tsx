import { Navigate, useParams } from 'react-router'

export default function PlayerRedirect() {
  const { id, episodeNumber } = useParams()
  return <Navigate to={episodeNumber ? `/watch/${id}/${episodeNumber}` : `/watch/${id}`} replace />
}
