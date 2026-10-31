import { canvasSchema, parseScene, type SceneEntity, type TeachingBeat } from '../../protocol/src/index.ts'
export * from './timeline'

export interface SceneSnapshot { revision: number; frameSequence: number; entities: SceneEntity[] }
export class SceneStore {
  private revision = 0
  private frameSequence = 0
  private entities: SceneEntity[] = []
  private frameOwners = new Map<string, Map<string, string>>()
  apply(patch: TeachingBeat['canvas'], expectedRevision = this.revision): SceneSnapshot {
    if (expectedRevision !== this.revision) throw new Error('Scene revision has changed; preserve the learner edit and replan')
    const checked = canvasSchema.parse(patch)
    if (checked.mode === 'replace') {
      this.entities = parseScene(checked.entities)
      this.frameOwners.clear()
    }
    else {
      const merged = new Map(this.entities.map(entity => [entity.id, entity]))
      for (const entity of checked.entities) merged.set(entity.id, { ...merged.get(entity.id), ...entity })
      this.entities = parseScene([...merged.values()])
      // A semantic edit claims the touched entity; a later animation cannot erase that edit.
      const changed = new Set(checked.entities.map(entity => entity.id))
      for (const [namespace, owned] of this.frameOwners) {
        for (const [sourceId, assignedId] of owned) if (changed.has(assignedId)) owned.delete(sourceId)
        if (!owned.size) this.frameOwners.delete(namespace)
      }
    }
    this.revision++
    return this.snapshot()
  }
  applyFrame(namespace: string, entities: SceneEntity[]): SceneSnapshot {
    if (!/^[\w:.-]{1,160}$/.test(namespace)) throw new Error('Invalid simulation namespace')
    const previous = this.frameOwners.get(namespace) ?? new Map<string, string>()
    const ownedIds = new Set(previous.values())
    const others = this.entities.filter(e => !ownedIds.has(e.id))
    const occupied = new Set(others.map(e => e.id))
    const ownership = new Map<string, string>()
    const next = parseScene(entities).map(entity => {
      let assignedId = previous.get(entity.id) ?? namespace + ':' + entity.id
      if (assignedId.length > 160 || occupied.has(assignedId)) assignedId = 'frame-' + crypto.randomUUID()
      ownership.set(entity.id, assignedId); occupied.add(assignedId)
      return { ...entity, id: assignedId }
    })
    const checked = parseScene([...others, ...next])
    this.entities = checked
    if (ownership.size) this.frameOwners.set(namespace, ownership)
    else this.frameOwners.delete(namespace)
    this.frameSequence++
    return this.snapshot()
  }
  restore(entities: SceneEntity[]): void { this.entities = parseScene(entities); this.frameOwners.clear(); this.revision++ }
  snapshot(): SceneSnapshot { return { revision: this.revision, frameSequence: this.frameSequence, entities: structuredClone(this.entities) } }
  visibleCheckpoint(): SceneSnapshot { return this.snapshot() }
}

