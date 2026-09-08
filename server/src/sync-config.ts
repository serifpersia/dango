import logger from './logger'

const log = logger.child({ module: 'SyncConfig' })

let activeRemote: 'mega' | 'gdrive' | undefined

export function setActiveRemote(remote: 'mega' | 'gdrive') {
  log.info({ remote }, 'Setting active sync remote')
  activeRemote = remote
}

export function getActiveRemote(): 'mega' | 'gdrive' | undefined {
  return activeRemote
}

export async function initialize(): Promise<void> {
  if (activeRemote !== 'gdrive') {
    log.info('Active remote is not gdrive, skipping gdrive-specific initialization.')
    return
  }
  log.info('gdrive is the active remote.')
}

export function getRemoteString(remoteDir: string): string {
  if (!activeRemote) {
    throw new Error('Cannot get remote string: active remote is not set.')
  }
  return `${activeRemote}:${remoteDir}`
}
