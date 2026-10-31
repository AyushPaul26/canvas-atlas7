import type { SimulationResult } from '../../protocol/src/index.ts'

export type ModelValues = Record<string, number | boolean | string>
/** A trusted, worker-owned model. Only the lesson owner advances its clock. */
export interface ModelSession {
  step(): SimulationResult
  input(values: ModelValues): SimulationResult
  render(): SimulationResult
  dispose(): void
}
