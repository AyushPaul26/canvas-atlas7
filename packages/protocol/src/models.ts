import type { Control } from './core'
import { mathModelSchema, validateMathBindings } from './math-model'
import { physicsModelSchema, validatePhysicsBindings } from './physics-model'
import type { MathModel } from './math-model'
import type { PhysicsModel } from './physics-model'

export type TeachingModel = MathModel | PhysicsModel
export const MODEL_SOURCE_BYTES = 64 * 1024

/** Model descriptions are data, never JavaScript or an import path. */
export function parseModelSource(source: string, controls: Control[]): TeachingModel {
  if (new TextEncoder().encode(source).byteLength > MODEL_SOURCE_BYTES) throw new Error('Interactive model description exceeds 64 KiB')
  let value: unknown
  try { value = JSON.parse(source) } catch { throw new Error('Interactive model must be a JSON description') }
  // Bound the tree before recursive expression-schema parsing.
  const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }]
  let count = 0
  while (pending.length) {
    const node = pending.pop()!
    if (++count > 12000 || node.depth > 24) throw new Error('Interactive model is too complex')
    if (node.value && typeof node.value === 'object') {
      for (const [key, child] of Object.entries(node.value)) {
        if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Interactive model contains an unsupported property')
        pending.push({ value: child, depth: node.depth + 1 })
      }
    }
  }
  const kind = value && typeof value === 'object' && 'kind' in value ? value.kind : undefined
  if (kind === 'math') {
    const model = mathModelSchema.parse(value)
    validateMathBindings(model, controls)
    return model
  }
  if (kind === 'physics') {
    const model = physicsModelSchema.parse(value)
    validatePhysicsBindings(model, controls)
    return model
  }
  throw new Error('Choose a supported maths or mechanics model')
}
