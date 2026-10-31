import { z } from 'zod'
import type { CourseRecord, LearnerEvidence } from './learning'
import type { DocumentManifest, SourceExcerpt, SourcePreview } from './documents'
import { narrationChunkSchema, type NarrationChunk, type LearningPlan, type LearningProgress } from './learning'
import { sourceRefSchema, type SourceRef } from './documents'
import { visualCueSchema, spatialSceneSchema, VISUAL_LIMITS, type VisualCue, type SpatialScene } from './visuals'
import type { PlaybackCheckpoint } from './playback'
import { parseModelSource } from './models'

export const LIMITS = Object.freeze({
  sourceBytes: 256 * 1024, entities: 2000, points: 100000, controls: 32,
  sceneBytes: 2 * 1024 * 1024, frameBytes: 256 * 1024, labelChars: 4000,
  guestHeap: 64 * 1024 * 1024, guestStack: 512 * 1024,
  initMs: 250, invocationMs: 20, watchdogMs: 500, workerReadyMs: 5000,
  fixedDt: 1 / 60, pendingBeats: 2, maxRepairAttempts: 2,
  learnerRequestChars: 6000, inputHistoryBytes: 1024 * 1024,
  checkpointBytes: 4 * 1024 * 1024,
  simulationRequestBytes: (4 * 1024 * 1024) + (256 * 1024) + (64 * 1024),
  saveBytes: (6 * 1024 * 1024) + (64 * 1024),
  // Aggregate envelopes include separately bounded state, replay and scene
  // trees. Their wrappers must not reduce any field's accepted allowance.
  checkpointNodes: 160000, simulationRequestNodes: 170000, saveNodes: 320000,
  envelopeDepth: 33,
  learningBeatBytes: (2 * 1024 * 1024) + (512 * 1024) + (256 * 1024), learningBeatNodes: 120000
})
const id = z.string().min(1).max(160).regex(/^[\w:.-]+$/)
const coordinate = z.number().finite().min(-1_000_000).max(1_000_000)
const color = z.string().max(40).regex(/^(#[\da-fA-F]{3,8}|transparent|none)$/)
export const sceneEntitySchema = z.object({
  id, kind: z.enum(['text', 'line', 'arrow', 'circle', 'ellipse', 'rect', 'path', 'equation', 'plot']),
  x: coordinate, y: coordinate,
  width: coordinate.optional(), height: coordinate.optional(), radius: z.number().finite().min(0).max(100000).optional(),
  text: z.string().max(LIMITS.labelChars).optional(), label: z.string().max(LIMITS.labelChars).optional(),
  points: z.array(coordinate).max(LIMITS.points).optional(), stroke: color.optional(), fill: color.optional(),
  fontSize: z.number().finite().min(1).max(300).optional(), strokeWidth: z.number().finite().min(0).max(50).optional(),
  opacity: z.number().finite().min(0).max(1).optional(), rotation: coordinate.optional(),
  semanticRole: z.string().max(240).optional()
}).strict()
export type SceneEntity = z.infer<typeof sceneEntitySchema>

export const controlSchema = z.object({
  id, label: z.string().min(1).max(160), type: z.enum(['slider', 'number', 'toggle', 'select']),
  value: z.union([z.number().finite(), z.boolean(), z.string().max(200)]),
  min: coordinate.optional(), max: coordinate.optional(), step: z.number().finite().positive().optional(),
  options: z.array(z.string().max(200)).max(50).optional(), unit: z.string().max(40).optional()
}).strict().superRefine((c, ctx) => {
  if (c.min !== undefined && c.max !== undefined && c.min >= c.max)
    ctx.addIssue({ code: 'custom', message: 'Control minimum must be below maximum' })
  if (c.type === 'slider' || c.type === 'number') {
    if (typeof c.value !== 'number') ctx.addIssue({ code: 'custom', message: 'Numeric control requires a finite number' })
    else if ((c.min !== undefined && c.value < c.min) || (c.max !== undefined && c.value > c.max))
      ctx.addIssue({ code: 'custom', message: 'Control value is outside its range' })
  }
  if (c.type === 'toggle' && typeof c.value !== 'boolean') ctx.addIssue({ code: 'custom', message: 'Toggle requires a boolean' })
  if (c.type === 'select' && (!c.options?.length || !c.options.includes(String(c.value))))
    ctx.addIssue({ code: 'custom', message: 'Choice is not one of the available options' })
})
export type Control = z.infer<typeof controlSchema>
export const simulationArtifactSchema = z.object({
  id, title: z.string().min(1).max(160),
  engine: z.enum(['quickjs', 'model']).optional(),
  source: z.string().min(1).max(LIMITS.sourceBytes).refine(s => new TextEncoder().encode(s).byteLength <= LIMITS.sourceBytes, 'Program is too large'),
  controls: z.array(controlSchema).max(LIMITS.controls),
  assumptions: z.array(z.string().max(800)).max(20),
  validation: z.enum(['illustrative', 'quantitative_checked', 'unresolved']).default('illustrative')
}).strict().superRefine((s, ctx) => {
  if (new Set(s.controls.map(c => c.id)).size !== s.controls.length) ctx.addIssue({ code: 'custom', message: 'Control IDs must be unique' })
  if (s.engine === 'model') {
    try { parseModelSource(s.source, s.controls) }
    catch (error) { ctx.addIssue({ code: 'custom', path: ['source'], message: error instanceof Error ? error.message : 'Interactive model could not be read' }) }
  }
})
export type SimulationArtifact = z.infer<typeof simulationArtifactSchema>
export interface SimulationCheckpoint {
  artifact: SimulationArtifact;
  state: unknown;
  tick: number;
  values: Record<string, number | boolean | string>;
  initialValues?: Record<string, number | boolean | string>;
  inputs?: Array<{ tick: number; values: Record<string, number | boolean | string> }>;
}
export const controlValuesSchema = z.record(z.string().min(1).max(160), z.union([z.number().finite(), z.boolean(), z.string().max(200)]))
  .refine(value => Object.keys(value).length <= LIMITS.controls)
export const simulationCheckpointSchema = z.object({
  artifact: simulationArtifactSchema, state: z.unknown(),
  tick: z.number().int().min(0).max(36000), values: controlValuesSchema,
  initialValues: controlValuesSchema.optional(),
  inputs: z.array(z.object({ tick: z.number().int().min(0).max(36000), values: controlValuesSchema }).strict()).max(1000).optional()
}).strict().superRefine((value, context) => {
  let previous = -1
  for (const entry of value.inputs ?? []) {
    if (entry.tick < previous || entry.tick > value.tick)
      context.addIssue({ code: 'custom', message: 'Experiment replay inputs must be ordered within the saved tick.' })
    previous = entry.tick
  }
  try {
    assertBoundedJson(JSON.stringify(value.inputs ?? []), LIMITS.inputHistoryBytes)
    if (value.state !== undefined) assertBoundedJson(JSON.stringify(value.state), LIMITS.sceneBytes)
    assertBoundedJson(JSON.stringify(value), LIMITS.checkpointBytes, { maxNodes: LIMITS.checkpointNodes })
  } catch (error) {
    context.addIssue({ code: 'custom', message: error instanceof Error ? error.message : 'Experiment checkpoint exceeds its local limit.' })
  }
})
export const canvasSchema = z.object({
  mode: z.enum(['replace', 'append', 'update']),
  entities: z.array(sceneEntitySchema).max(LIMITS.entities)
}).strict().superRefine((s, ctx) => {
  if (new Set(s.entities.map(e => e.id)).size !== s.entities.length)
    ctx.addIssue({ code: 'custom', message: 'Entity IDs must be unique' })
  if (s.entities.reduce((n,e) => n + (e.points?.length ?? 0), 0) > LIMITS.points)
    ctx.addIssue({ code: 'custom', message: 'Too many path samples' })
})
export const teachingBeatDraftSchema = z.object({
  id: id.optional(),
  narration: z.string().min(1).max(8000),
  title: z.string().max(180).optional(),
  canvas: canvasSchema,
  simulation: simulationArtifactSchema.optional(),
  question: z.string().max(1500).optional(),
  next: z.enum(['continue', 'ask', 'finish']).optional(),
  conceptId: id.optional(), chunks: z.array(narrationChunkSchema).min(1).max(VISUAL_LIMITS.chunks).optional(),
  cues: z.array(visualCueSchema).max(VISUAL_LIMITS.cues).optional(),
  sourceRefs: z.array(sourceRefSchema).max(100).optional(), spatialScene: spatialSceneSchema.optional()
}).strict().superRefine((beat,ctx)=>{
  const chunks=beat.chunks??[]
  if(beat.chunks&&(chunks.map(chunk=>chunk.text).join('')!==beat.narration||new Set(chunks.map(chunk=>chunk.id)).size!==chunks.length))ctx.addIssue({code:'custom',message:'Unique chunks must concatenate exactly to narration'})
  if(new Set(beat.cues?.map(cue=>cue.id)).size!==(beat.cues?.length??0))ctx.addIssue({code:'custom',message:'Cue IDs must be unique'})
  const targets=new Set([...beat.canvas.entities.map(entity=>entity.id),...(beat.spatialScene?.nodes.map(node=>node.id)??[])])
  for(const cue of beat.cues??[]){
    if(!chunks.some(chunk=>chunk.id===cue.chunkId))ctx.addIssue({code:'custom',message:'Cue references an unknown narration chunk'})
    if('targetId' in cue.action&&!targets.has(cue.action.targetId))ctx.addIssue({code:'custom',message:'Cue references an unknown visual target'})
    if(cue.action.type==='path'){const action=cue.action;if(!beat.canvas.entities.some(entity=>entity.id===action.targetId)||beat.spatialScene?.nodes.some(node=>node.id===action.targetId))ctx.addIssue({code:'custom',message:'Path motion requires a unique 2D canvas target'})}
    if(cue.action.type==='experiment'){
      const action=cue.action,control=beat.simulation?.controls.find(control=>control.id===action.controlId)
      if(!control||!controlSchema.safeParse({...control,value:action.value}).success)ctx.addIssue({code:'custom',message:'Cue references an unknown or invalid experiment control'})
    }
    if(cue.action.type==='tween'){
      const action=cue.action
      if(action.property==='opacity'&&[action.from,action.to].some(value=>value<0||value>1))ctx.addIssue({code:'custom',message:'Opacity tween is outside its range'})
      if(['radius','strokeWidth','fontSize'].includes(action.property)&&[action.from,action.to].some(value=>value<0))ctx.addIssue({code:'custom',message:'Tween value is outside its range'})
    }
  }
  if(beat.spatialScene&&!beat.canvas.entities.length)ctx.addIssue({code:'custom',message:'Spatial scenes require an explanatory 2D fallback'})
})
type JsonSchema = { type?: string; properties?: Record<string, JsonSchema>; required?: string[]; items?: JsonSchema }
const teachingInputSchema = z.toJSONSchema(teachingBeatDraftSchema, { unrepresentable: 'any', io: 'input' }) as JsonSchema
/** Strict provider schemas represent omitted optional properties with null. Required or unknown nulls remain invalid. */
function normalizeToolOptionals(value: unknown, schema: JsonSchema, depth = 0): unknown {
  if (depth > 32) throw new Error('Teaching step is too complex')
  if (Array.isArray(value)) return value.map(item => normalizeToolOptionals(item, schema.items ?? {}, depth + 1))
  if (!value || typeof value !== 'object') return value
  const output: Record<string, unknown> = Object.create(null)
  for (const [key, child] of Object.entries(value)) {
    const property = schema.properties && Object.hasOwn(schema.properties, key) ? schema.properties[key] : undefined
    if (child === null && property && !schema.required?.includes(key)) continue
    output[key] = normalizeToolOptionals(child, property ?? {}, depth + 1)
  }
  return output
}
export interface TeachingBeat {
  id: string; narration: string; title?: string;
  canvas: z.infer<typeof canvasSchema>; simulation?: SimulationArtifact; question?: string; next?: 'continue' | 'ask' | 'finish';
  conceptId?: string; chunks?: NarrationChunk[]; cues?: VisualCue[]; sourceRefs?: SourceRef[]; spatialScene?: SpatialScene
}
export function parseTeachingBeat(value: unknown): TeachingBeat {
  const parsed = teachingBeatDraftSchema.parse(normalizeToolOptionals(value, teachingInputSchema))
  const extended=parsed.chunks!==undefined||parsed.cues!==undefined||parsed.spatialScene!==undefined||parsed.sourceRefs!==undefined||parsed.conceptId!==undefined
  // Preserve the existing board allowance; new declarative fields get additive space.
  if (new TextEncoder().encode(JSON.stringify(parsed.canvas.entities)).byteLength > LIMITS.sceneBytes) throw new Error('Scene exceeds the serialized size limit')
  assertBoundedJson(JSON.stringify(parsed),extended?LIMITS.learningBeatBytes:LIMITS.sceneBytes,{maxNodes:extended?LIMITS.learningBeatNodes:100000,maxDepth:LIMITS.envelopeDepth})
  // Only independent app-side checks can promote an experiment's evidence status.
  if (parsed.simulation) parsed.simulation.validation = 'illustrative'
  return { ...parsed, id: parsed.id ?? crypto.randomUUID() }
}
export interface ModelInfo { id: string; name: string }
export interface AccountProfile { id: string; name?: string; email?: string }
export interface AppStatus {
  connected: boolean; planEnabled: boolean; account?: AccountProfile; model?: string; modelAvailable?: boolean; error?: string; desktop: boolean;
  teachingProvider?: import('./ai').ProviderId; teachingConnected?: boolean; teachingReady?: boolean; teachingRevision?: number
}
export interface ModelRunMetadata { requestedModel: string; servedModel?: string; responseId?: string; completedAt: string; providerId?: import('./ai').ProviderId }
export interface LessonMessage { id: string; role: 'student' | 'tutor'; text: string; createdAt: string }
export interface LessonSession {
  learnerEvidence?: LearnerEvidence[];
  id: string; title: string; topic: string; createdAt: string; updatedAt: string;
  messages: LessonMessage[]; beats: TeachingBeat[]; scene: SceneEntity[];
  controls: Record<string, number | boolean | string>
  simulation?: SimulationCheckpoint
  modelRuns?: ModelRunMetadata[]
  plan?: LearningPlan
  learningProgress?: LearningProgress
  playback?: PlaybackCheckpoint
}
export interface SessionSummary { id: string; title: string; topic: string; updatedAt: string; messageCount: number }
export type TutorPhase = 'thinking' | 'drawing' | 'speaking' | 'ready' | 'paused'
export type TutorEvent =
  | { type: 'document-progress'; progress: { jobId: string; documentId?: string; status: 'starting' | 'extracting' | 'complete' | 'cancelled' | 'failed'; pagesProcessed: number; totalPages: number; warnings: string[] } }
  | { type: 'closing' }
  | { type: 'status'; sessionId: string; phase: TutorPhase; epoch: number }
  | { type: 'beat'; sessionId: string; beat: TeachingBeat; epoch: number; baselineScene?: SceneEntity[] }
  | { type: 'error'; sessionId?: string; message: string; epoch?: number }
  | { type: 'done'; sessionId: string; epoch: number }
  | { type: 'auth'; status: AppStatus }
  | { type: 'model'; sessionId: string; epoch: number; metadata: ModelRunMetadata }
export interface VoiceStatus { recognitionReady: boolean; synthesisReady: boolean; downloading?: string; progress?: number; error?: string; synthesisEngine?: 'kokoro' | 'windows-sapi' | 'elevenlabs' | null; voiceName?: string; neuralReady?: boolean; configurationRevision?: number }
export interface SimulationInput {
  runId: string; artifact: SimulationArtifact; action: 'init' | 'step' | 'input' | 'render';
  state?: unknown; tick: number; dt?: number; values?: Record<string, number | boolean | string>
  replay?: SimulationCheckpoint
}
export interface SimulationResult { state: unknown; entities: SceneEntity[]; measurements?: Record<string, number | string>; error?: string }
export interface TutorBridge {
  planTopic(input: { sessionId: string; level?: string }): Promise<import('./learning').LearningPlan>;
  startConcept(input: { sessionId: string; conceptId: string }): Promise<void>;
  savePlayback(input: { sessionId: string; epoch: number; checkpoint: PlaybackCheckpoint }): Promise<void>;
  resumePlayback(input: { sessionId: string; mode: 'resume' | 'replay' }): Promise<{ beat: TeachingBeat; epoch: number; checkpoint?: PlaybackCheckpoint; mode: 'resume' | 'replay' }>;
  returnToLesson(input: { sessionId: string }): Promise<{ beat: TeachingBeat; epoch: number; checkpoint: PlaybackCheckpoint; mode: 'resume' | 'replay' }>;
  importStudyMaterial(input?: { jobId?: string }): Promise<DocumentManifest[]>;
  cancelDocumentImport(jobId: string): Promise<void>;
  getDocuments(): Promise<DocumentManifest[]>;
  getSourceExcerpt(ref: SourceRef): Promise<SourceExcerpt>;
  getSourcePreview(ref: SourceRef): Promise<SourcePreview>;
  planCourse(input: { documentIds: string[] }): Promise<CourseRecord>;
  getCourses(): Promise<CourseRecord[]>;
  loadCourse(courseId: string): Promise<CourseRecord>;
  startCourseLesson(input: { courseId: string; lessonId: string }): Promise<LessonSession>;
  readyToClose(): Promise<void>;
  getStatus(): Promise<AppStatus>;
  signIn(): Promise<AppStatus>;
  signOut(): Promise<AppStatus>;
  getModels(): Promise<ModelInfo[]>;
  setModel(id: string): Promise<AppStatus>;
  getTeachingConfiguration(): Promise<import('./ai').TeachingConfiguration>;
  refreshTeachingModels(providerId: import('./ai').ProviderId): Promise<import('./ai').TeachingConfiguration>;
  selectTeachingProvider(input: {providerId: import('./ai').ProviderId; modelId?: string}): Promise<import('./ai').TeachingConfiguration>;
  connectTeachingKey(input: {providerId: import('./ai').ApiProviderId; key: string}): Promise<import('./ai').TeachingConfiguration>;
  clearTeachingKey(providerId: import('./ai').ApiProviderId): Promise<import('./ai').TeachingConfiguration>;
  getSessions(): Promise<SessionSummary[]>;
  loadSession(id: string): Promise<LessonSession>;
  createSession(topic: string, requestId?: string): Promise<LessonSession>;
  cancelSafetyAdmission(requestId: string): Promise<void>;
  sendMessage(input: { sessionId: string; text: string; selectionIds?: string[] }): Promise<void>;
  continueLesson(input: { sessionId: string; epoch: number }): Promise<void>;
  interrupt(sessionId: string): Promise<void>;
  saveScene(input: { sessionId: string; scene: SceneEntity[]; controls?: Record<string, number | boolean | string>; simulation?: SimulationCheckpoint }): Promise<void>;
  presentProgress(input: { sessionId: string; epoch: number; beatId: string; scene: SceneEntity[]; narration: string; complete: boolean }): Promise<void>;
  deleteSession(id: string): Promise<void>;
  exportLesson(id: string): Promise<{ canceled: boolean; path?: string }>;
  getLessonNotes(sessionId: string): Promise<import('./notes').LessonNotesRecord | null>;
  generateLessonNotes(input: { sessionId: string; mode?: 'ai' | 'local' }): Promise<import('./notes').LessonNotesRecord>;
  cancelLessonNotes(sessionId: string): Promise<void>;
  openLessonNotes(input: { sessionId: string; notesId: string }): Promise<void>;
  exportLessonNotes(input: { sessionId: string; notesId: string }): Promise<{ canceled: boolean; path?: string }>;
  onEvent(callback: (event: TutorEvent) => void): () => void;
  voiceStatus(): Promise<VoiceStatus>;
  installVoiceModel(modelId: string): Promise<VoiceStatus>;
  transcribeAudio(audio: ArrayBuffer): Promise<string>;
  synthesizeSpeech(text: string, job?: import('./speech').SpeechJob): Promise<{ samples: Float32Array; sampleRate: number } | null>;
  cancelSpeech(requestId: string): Promise<void>;
  getVoiceConfiguration(): Promise<import('./speech').VoiceConfiguration>;
  saveVoiceConfiguration(settings: import('./speech').VoiceSettings): Promise<import('./speech').VoiceConfiguration>;
  setElevenLabsKey(key: string): Promise<import('./speech').VoiceConfiguration>;
  clearElevenLabsKey(): Promise<import('./speech').VoiceConfiguration>;
  listElevenLabsVoices(query?: {search?:string;nextPageToken?:string}): Promise<import('./speech').VoicePage>;
  onVoiceProgress(callback: (status: VoiceStatus) => void): () => void;
  runSimulation(input: SimulationInput): Promise<SimulationResult>;
}

export function parseScene(entities: unknown): SceneEntity[] {
  const scene = canvasSchema.parse({ mode: 'replace', entities }).entities
  if (new TextEncoder().encode(JSON.stringify(scene)).byteLength > LIMITS.sceneBytes) throw new Error('Scene exceeds the serialized size limit')
  return scene
}
export function assertBoundedJson(text: string, maxBytes = LIMITS.sceneBytes, bounds: { maxNodes?: number; maxDepth?: number } = {}): unknown {
  if (new TextEncoder().encode(text).byteLength > maxBytes) throw new Error('Output exceeds the message size limit')
  const value: unknown = JSON.parse(text)
  const stack: Array<[unknown, number]> = [[value, 0]]
  let count = 0
  const maxNodes = bounds.maxNodes ?? 100000, maxDepth = bounds.maxDepth ?? 32
  while (stack.length) {
    const [item, depth] = stack.pop()!
    if (depth > maxDepth || ++count > maxNodes) throw new Error('Output is too complex')
    if (typeof item === 'number' && !Number.isFinite(item)) throw new Error('Numbers must be finite')
    if (item && typeof item === 'object') {
      for (const [key, child] of Object.entries(item)) {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') throw new Error('Reserved object property')
        stack.push([child, depth + 1])
      }
    }
  }
  return value
}
