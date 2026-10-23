// OAuth credentials and account state belong to this server, not library exports.
export function isLocalTrackerSetting(key: unknown): boolean {
  return (
    typeof key === 'string' &&
    (key.startsWith('tracker_mal_client_') ||
      [
        'tracker_mal_tokens',
        'tracker_mal_user',
        'tracker_mal_oauth_pending',
        'tracker_mal_sync_state',
      ].includes(key) ||
      key.startsWith('tracker_rewatch_'))
  )
}

export function isPrivateTrackerSetting(key: string): boolean {
  return ['tracker_mal_client_secret', 'tracker_mal_tokens', 'tracker_mal_oauth_pending'].includes(
    key
  )
}
