import { usePopup } from './usePopup'

export interface AsmrPopupData {
  rjCode: string
  title: string
  thumbnail?: string
  isAdult?: boolean
  rating?: string
  listenTarget: string
  progressLabel?: string
}

export const useAsmrPopup = () => usePopup<AsmrPopupData>()
