import {z} from 'zod';
import {contractIdSchema as id} from './documents';
import {providerIdSchema} from './ai';
import {sceneEntitySchema,parseScene,assertBoundedJson,LIMITS} from './core';

export const NOTES_LIMITS=Object.freeze({contextBytes:120000,draftBytes:200000,documentBytes:4*1024*1024,pdfBytes:32*1024*1024,visuals:6,sections:16});
const text=(max:number)=>z.string().trim().min(1).max(max);
const evidence=z.array(id).min(1).max(100).refine(items=>new Set(items).size===items.length,'Evidence IDs must be unique');
const modelId=z.string().min(1).max(200).regex(/^[A-Za-z0-9][\w:./-]*$/);
export const studyNotesDraftSchema=z.object({
  title:text(240),overview:text(4000),
  sections:z.array(z.object({
    title:text(240),evidenceIds:evidence,explanation:text(10000),keyPoints:z.array(text(1200)).max(16),
    definitions:z.array(z.object({term:text(160),meaning:text(2000)}).strict()).max(16),
    equations:z.array(z.object({latex:text(1500),explanation:text(1500)}).strict()).max(12),
    examples:z.array(z.object({title:text(240),explanation:text(5000)}).strict()).max(8),
  }).strict()).min(1).max(NOTES_LIMITS.sections),
  recap:z.array(text(1200)).min(1).max(24),
  reviewQuestions:z.array(z.object({question:text(1000),answer:text(3000),evidenceIds:evidence}).strict()).max(12),
}).strict().superRefine((value,context)=>{
  try{assertBoundedJson(JSON.stringify(value),NOTES_LIMITS.draftBytes,{maxNodes:20000,maxDepth:16});}
  catch{context.addIssue({code:'custom',message:'Study notes exceed the document size limit.'});}
});
export type StudyNotesDraft=z.infer<typeof studyNotesDraftSchema>;
export const notesVisualSchema=z.object({evidenceId:id,title:text(240),entities:z.array(sceneEntitySchema).max(LIMITS.entities)}).strict().superRefine((value,context)=>{
  try{parseScene(value.entities);}catch{context.addIssue({code:'custom',message:'Invalid notes diagram.'});}
});
export type NotesVisual=z.infer<typeof notesVisualSchema>;
const notesProviderId=z.union([providerIdSchema,z.literal('local')]);
const metadata=z.object({providerId:notesProviderId,requestedModel:modelId,servedModel:modelId.optional(),responseId:modelId.optional(),completedAt:z.string().datetime()}).strict();
export const studyNotesDocumentSchema=z.object({
  version:z.literal(1),id:z.string().uuid(),sessionId:id,topic:text(6000),createdAt:z.string().datetime(),
  coverageHash:z.string().regex(/^[a-f0-9]{64}$/),studiedSteps:z.number().int().min(1).max(5000),
  content:studyNotesDraftSchema,visuals:z.array(notesVisualSchema).max(NOTES_LIMITS.visuals),modelMetadata:metadata,
}).strict().superRefine((value,context)=>{
  try{assertBoundedJson(JSON.stringify(value),NOTES_LIMITS.documentBytes,{maxNodes:1000000,maxDepth:32});}
  catch{context.addIssue({code:'custom',message:'Study notes and diagrams exceed the document size limit.'});}
});
export type StudyNotesDocument=z.infer<typeof studyNotesDocumentSchema>;
export const lessonNotesRecordSchema=z.object({
  id:z.string().uuid(),sessionId:id,title:text(240),createdAt:z.string().datetime(),studiedSteps:z.number().int().min(1).max(5000),
  providerId:notesProviderId,requestedModel:modelId,servedModel:modelId.optional(),
}).strict();
export type LessonNotesRecord=z.infer<typeof lessonNotesRecordSchema>;
