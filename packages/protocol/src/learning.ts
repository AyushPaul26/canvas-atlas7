import { z } from 'zod'
import { contractIdSchema as id, sourceRefSchema } from './documents'
import type { TeachingBeat } from './core'
import { VISUAL_LIMITS, type VisualCue } from './visuals'

export const LEARNING_LIMITS=Object.freeze({concepts:40,courseLessons:30,planBytes:512*1024,planNodes:20000})
export const narrationChunkSchema=z.object({id,text:z.string().min(1).max(VISUAL_LIMITS.chunkChars)}).strict()
export type NarrationChunk=z.infer<typeof narrationChunkSchema>
export const learningPlanSchema=z.object({id,version:z.number().int().positive(),title:z.string().min(1).max(240),sourceDocumentIds:z.array(id).max(100),concepts:z.array(z.object({id,title:z.string().min(1).max(240),objectives:z.array(z.string().min(1).max(1000)).min(1).max(12),prerequisiteIds:z.array(id).max(LEARNING_LIMITS.concepts),sourceRefs:z.array(sourceRefSchema).max(100)}).strict()).min(1).max(LEARNING_LIMITS.concepts)}).strict().superRefine((value,ctx)=>{
  const concepts=new Map(value.concepts.map(concept=>[concept.id,concept]))
  if(concepts.size!==value.concepts.length||new Set(value.sourceDocumentIds).size!==value.sourceDocumentIds.length)ctx.addIssue({code:'custom',message:'Plan IDs must be unique'})
  const visiting=new Set<string>(),visited=new Set<string>()
  const visit=(conceptId:string):boolean=>{
    if(visiting.has(conceptId))return false
    if(visited.has(conceptId))return true
    const concept=concepts.get(conceptId);if(!concept)return false
    visiting.add(conceptId)
    for(const prerequisite of concept.prerequisiteIds)if(!visit(prerequisite))return false
    visiting.delete(conceptId);visited.add(conceptId);return true
  }
  for(const concept of value.concepts){
    if(!visit(concept.id))ctx.addIssue({code:'custom',message:'Prerequisites must reference existing concepts and form an acyclic graph'})
    if(new Set(concept.prerequisiteIds).size!==concept.prerequisiteIds.length)ctx.addIssue({code:'custom',message:'Prerequisite IDs must be unique'})
    for(const ref of concept.sourceRefs)if(!value.sourceDocumentIds.includes(ref.documentId))ctx.addIssue({code:'custom',message:'Concept references an unknown source document'})
  }
  if(new TextEncoder().encode(JSON.stringify(value)).byteLength>LEARNING_LIMITS.planBytes)ctx.addIssue({code:'custom',message:'Learning plan exceeds its size budget'})
  let count=0;const pending:unknown[]=[value];while(pending.length){const item=pending.pop();count++;if(item&&typeof item==='object')pending.push(...Object.values(item))}
  if(count>LEARNING_LIMITS.planNodes)ctx.addIssue({code:'custom',message:'Learning plan exceeds its node budget'})
})
export type LearningPlan=z.infer<typeof learningPlanSchema>
const status=z.enum(['planned','teaching','paused','checking','completed'])
export const learningProgressSchema=z.object({planId:id,planVersion:z.number().int().positive(),activeConceptId:id,conceptStates:z.record(id,status).refine(value=>Object.keys(value).length<=LEARNING_LIMITS.concepts),pendingCheck:z.object({conceptId:id,question:z.string().min(1).max(1500),evidence:z.object({kind:z.enum(['answered','help-requested','skipped']),answer:z.string().max(6000).optional(),createdAt:z.string().datetime()}).strict().optional()}).strict().optional(),branchReturnPoint:z.object({beatId:id,chunkId:id,offsetSeconds:z.number().finite().min(0).max(86400),passId:id}).strict().optional(),status}).strict()
export type LearningProgress=z.infer<typeof learningProgressSchema>
/** Observed responses are retained separately from presentation coverage; no mastery is inferred. */
export const learnerEvidenceSchema=z.object({id,sessionId:id,planId:id,planVersion:z.number().int().positive(),conceptId:id,question:z.string().min(1).max(1500),kind:z.enum(['answered','help-requested','skipped']),answer:z.string().max(6000),createdAt:z.string().datetime()}).strict()
export type LearnerEvidence=z.infer<typeof learnerEvidenceSchema>
export type AdaptedTeachingBeat=TeachingBeat&{chunks:NarrationChunk[];cues:VisualCue[]}
/** Legacy limits accepted up to 8,000 chars. Preserve that allowance when adapting old records. */
export function adaptTeachingBeat(beat:TeachingBeat):AdaptedTeachingBeat {
  if(beat.chunks)return {...beat,chunks:beat.chunks,cues:beat.cues??[]}
  const chunks:NarrationChunk[]=[];let remaining=beat.narration
  while(remaining){
    let length=Math.min(VISUAL_LIMITS.chunkChars,remaining.length)
    if(length<remaining.length){const candidate=remaining.slice(0,length);const sentence=[...candidate.matchAll(/[.!?](?:\s+|$)/g)].at(-1);const boundary=sentence?sentence.index+sentence[0].length:Math.max(candidate.lastIndexOf(' ')+1,candidate.lastIndexOf('\n')+1);if(boundary>0)length=boundary;if(/[\uD800-\uDBFF]/.test(remaining[length-1])&&/[\uDC00-\uDFFF]/.test(remaining[length]))length--}
    chunks.push({id:`${beat.id.slice(0,140)}:chunk:${chunks.length+1}`,text:remaining.slice(0,length)});remaining=remaining.slice(length)
  }
  return {...beat,chunks,cues:[]}
}
export interface CourseLesson {id:string;title:string;objectives:string[];conceptIds:string[];sourceRefs:z.infer<typeof sourceRefSchema>[];sessionId?:string}
export interface CourseRecord {id:string;title:string;plan:LearningPlan;documentIds:string[];sessionIds:string[];lessons?:CourseLesson[];progress:LearningProgress;createdAt:string;updatedAt:string}
export const courseLessonSchema=z.object({id,title:z.string().min(1).max(240),objectives:z.array(z.string().min(1).max(1000)).min(1).max(12),conceptIds:z.array(id).min(1).max(LEARNING_LIMITS.concepts),sourceRefs:z.array(sourceRefSchema).max(100),sessionId:id.optional()}).strict()
export const courseRecordSchema=z.object({id,title:z.string().min(1).max(240),plan:learningPlanSchema,documentIds:z.array(id).max(100),sessionIds:z.array(id).max(LEARNING_LIMITS.courseLessons),lessons:z.array(courseLessonSchema).max(LEARNING_LIMITS.courseLessons).optional(),progress:learningProgressSchema,createdAt:z.string().datetime(),updatedAt:z.string().datetime()}).strict().superRefine((course,ctx)=>{
  for(const values of [course.documentIds,course.sessionIds,course.lessons?.map(lesson=>lesson.id)??[]])if(new Set(values).size!==values.length)ctx.addIssue({code:'custom',message:'Course IDs must be unique'})
  if(course.plan.sourceDocumentIds.some(id=>!course.documentIds.includes(id)))ctx.addIssue({code:'custom',message:'Course is missing a plan document'})
  for(const lesson of course.lessons??[]){if(lesson.conceptIds.some(id=>!course.plan.concepts.some(concept=>concept.id===id))||lesson.sourceRefs.some(ref=>!course.documentIds.includes(ref.documentId))||(lesson.sessionId&&!course.sessionIds.includes(lesson.sessionId)))ctx.addIssue({code:'custom',message:'Lesson references an unknown concept, source or session'})}
  try{assertProgressForPlan(course.progress,course.plan)}catch(error){ctx.addIssue({code:'custom',message:error instanceof Error?error.message:'Invalid course progress'})}
  if(new TextEncoder().encode(JSON.stringify(course)).byteLength>LEARNING_LIMITS.planBytes*2)ctx.addIssue({code:'custom',message:'Course exceeds its aggregate size budget'})
})
export function initialLearningProgress(plan:LearningPlan):LearningProgress{return {planId:plan.id,planVersion:plan.version,activeConceptId:plan.concepts[0].id,conceptStates:Object.fromEntries(plan.concepts.map(concept=>[concept.id,'planned' as const])),status:'planned'}}
export function assertProgressForPlan(progress:LearningProgress,plan:LearningPlan):void{
  if(progress.planId!==plan.id||progress.planVersion!==plan.version||!plan.concepts.some(concept=>concept.id===progress.activeConceptId)||Object.keys(progress.conceptStates).some(key=>!plan.concepts.some(concept=>concept.id===key))||plan.concepts.some(concept=>!Object.hasOwn(progress.conceptStates,concept.id))||(progress.pendingCheck&&!plan.concepts.some(concept=>concept.id===progress.pendingCheck!.conceptId)))throw new Error('Learning progress does not match this plan version')
}
