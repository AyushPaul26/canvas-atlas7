import { z } from 'zod'
import { contractIdSchema as id } from './documents'

export const VISUAL_LIMITS=Object.freeze({chunks:16,chunkChars:240,cues:128,pathPoints:64,spatialNodes:128,vertices:50000,spatialBytes:512*1024})
const bounded=z.number().finite().min(-1_000_000).max(1_000_000)
const point=z.tuple([bounded,bounded,bounded])
export const visualCueSchema=z.object({id,chunkId:id,at:z.union([z.enum(['start','end']),z.number().finite().min(0).max(1)]),action:z.discriminatedUnion('type',[
  z.object({type:z.literal('visibility'),targetId:id,visible:z.boolean()}).strict(),
  z.object({type:z.literal('highlight'),targetId:id,active:z.boolean()}).strict(),
  z.object({type:z.literal('tween'),targetId:id,property:z.enum(['x','y','width','height','radius','opacity','rotation','strokeWidth','fontSize']),from:bounded,to:bounded,durationMs:z.number().finite().min(0).max(60000)}).strict(),
  z.object({type:z.literal('path'),targetId:id,points:z.array(z.object({x:bounded,y:bounded}).strict()).min(2).max(VISUAL_LIMITS.pathPoints),durationMs:z.number().finite().min(0).max(60000)}).strict(),
  z.object({type:z.literal('camera'),x:bounded,y:bounded,zoom:z.number().finite().min(0.05).max(100),durationMs:z.number().finite().min(0).max(60000)}).strict(),
  z.object({type:z.literal('experiment'),controlId:id,value:z.union([z.number().finite(),z.boolean(),z.string().max(200)])}).strict()
])}).strict()
export type VisualCue=z.infer<typeof visualCueSchema>
export const spatialSceneSchema=z.object({
  nodes:z.array(z.object({id,kind:z.enum(['box','sphere','cylinder','cone','plane','line','arrow']),position:point,rotation:point.optional(),scale:z.tuple([z.number().finite().positive().max(10000),z.number().finite().positive().max(10000),z.number().finite().positive().max(10000)]).optional(),material:z.enum(['neutral','blue','green','orange','red','purple','wireframe']),label:z.string().max(240).optional(),segments:z.number().int().min(3).max(128).optional()}).strict()).max(VISUAL_LIMITS.spatialNodes),
  camera:z.object({position:point,target:point}).strict(),fallbackDescription:z.string().min(1).max(2000)
}).strict().superRefine((value,ctx)=>{
  if(new Set(value.nodes.map(node=>node.id)).size!==value.nodes.length)ctx.addIssue({code:'custom',message:'Spatial node IDs must be unique'})
  const vertices=value.nodes.reduce((count,node)=>count+(node.kind==='sphere'?(node.segments??16)**2*2:node.kind==='cylinder'||node.kind==='cone'?(node.segments??16)*12:36),0)
  if(vertices>VISUAL_LIMITS.vertices)ctx.addIssue({code:'custom',message:'Spatial scene exceeds its vertex budget'})
  if(new TextEncoder().encode(JSON.stringify(value)).byteLength>VISUAL_LIMITS.spatialBytes)ctx.addIssue({code:'custom',message:'Spatial scene exceeds its size budget'})
})
export type SpatialScene=z.infer<typeof spatialSceneSchema>
