import type { AsmrWork } from '../hooks/useAsmr'

export function buildAsmrId(rjCode: string): string {
  return String(rjCode || '')
    .trim()
    .toUpperCase()
}

export function asmrWorkId(work: Pick<AsmrWork, 'id' | '_id'>): string {
  return buildAsmrId(work.id || work._id || '')
}

export function isAsmrAdult(work: { isAdult?: boolean }): boolean {
  return !!work.isAdult
}
