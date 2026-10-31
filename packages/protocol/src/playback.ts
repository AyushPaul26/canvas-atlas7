import { z } from 'zod'
import { assertBoundedJson, LIMITS, parseScene, sceneEntitySchema, simulationCheckpointSchema } from './core'
import { contractIdSchema as id } from './documents'
import { learningProgressSchema } from './learning'

const maxChunkReferences=8000,maxCueReferences=128
// A valid scene contains its array, entity objects, every scalar/array property,
// and all point samples. Merged accepted boards retain this full scene allowance.
const sceneNodes=1+LIMITS.entities*(1+Object.keys(sceneEntitySchema.shape).length)+LIMITS.points
// Checkpoints and receipts each hold chunk/cue IDs. The remainder covers cursor,
// receipt/progress objects and their bounded scalar fields, independently of scenes.
const metadataNodes=2*(maxChunkReferences+maxCueReferences)+1024
export const PLAYBACK_LIMITS=Object.freeze({bytes:LIMITS.checkpointBytes+2*LIMITS.sceneBytes+1024*1024,nodes:LIMITS.checkpointNodes+2*sceneNodes+metadataNodes,depth:LIMITS.envelopeDepth+2})
export const audioResultSchema=z.enum(['completed','paused','interrupted','failed','unavailable'])
export type AudioResult=z.infer<typeof audioResultSchema>
export const playbackCursorSchema=z.object({beatId:id,chunkId:id,offsetSeconds:z.number().finite().min(0).max(86400),passId:id}).strict()
export type PlaybackCursor=z.infer<typeof playbackCursorSchema>
// Legacy adaptation may require >16 chunks, without reducing the old narration allowance.
const chunkIds=z.array(id).max(maxChunkReferences).refine(value=>new Set(value).size===value.length,'Chunk IDs must be unique')
const cueIds=z.array(id).max(maxCueReferences).refine(value=>new Set(value).size===value.length,'Cue IDs must be unique')
export const presentationReceiptSchema=z.object({beatId:id,planId:id,planVersion:z.number().int().positive(),passId:id,completedChunkIds:chunkIds,appliedCueIds:cueIds,audioResult:audioResultSchema,visualComplete:z.boolean()}).strict()
export type PresentationReceipt=z.infer<typeof presentationReceiptSchema>
export const playbackCheckpointSchema=z.object({cursor:playbackCursorSchema,completedChunkIds:chunkIds,appliedCueIds:cueIds,baselineScene:z.array(sceneEntitySchema).max(LIMITS.entities),visibleScene:z.array(sceneEntitySchema).max(LIMITS.entities),simulation:simulationCheckpointSchema.optional(),receipt:presentationReceiptSchema.optional(),progress:learningProgressSchema.optional()}).strict().superRefine((value,ctx)=>{
  try{parseScene(value.baselineScene);parseScene(value.visibleScene);assertBoundedJson(JSON.stringify(value),PLAYBACK_LIMITS.bytes,{maxNodes:PLAYBACK_LIMITS.nodes,maxDepth:PLAYBACK_LIMITS.depth})}catch(error){ctx.addIssue({code:'custom',message:error instanceof Error?error.message:'Invalid playback envelope'})}
  if(value.receipt&&(value.receipt.beatId!==value.cursor.beatId||value.receipt.passId!==value.cursor.passId||value.receipt.completedChunkIds.some(chunk=>!value.completedChunkIds.includes(chunk))||value.receipt.appliedCueIds.some(cue=>!value.appliedCueIds.includes(cue))))ctx.addIssue({code:'custom',message:'Receipt must acknowledge this playback pass'})
})
export type PlaybackCheckpoint=z.infer<typeof playbackCheckpointSchema>
