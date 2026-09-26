import logger from '../logger.js'

export interface IpcMessage {
  type: 'SYNC_START' | 'SYNC_END' | 'SERVER_EXIT'
  message?: string
}

function sendToParent(message: IpcMessage) {
  try {
    if (typeof process.send === 'function') {
      process.send(message)
    }
  } catch {
    // ignore
  }
}

export function notifySyncStart(message: string) {
  sendToParent({ type: 'SYNC_START', message })
  logger.info(`[SYNC_START] ${message}`)
}

export function notifySyncEnd() {
  sendToParent({ type: 'SYNC_END' })
  logger.info('[SYNC_END]')
}

export function notifyServerExit() {
  sendToParent({ type: 'SERVER_EXIT' })
  logger.info('[SERVER_EXIT]')
}
