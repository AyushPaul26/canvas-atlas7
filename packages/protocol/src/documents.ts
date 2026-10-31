import { z } from 'zod'

export const contractIdSchema = z.string().min(1).max(160).regex(/^[\w:.-]+$/)
export const DOCUMENT_LIMITS = Object.freeze({ maxBytes:32*1024*1024,maxSections:4000,sectionChars:200000,totalTextChars:4_000_000,maxPages:1000,previewBytes:2*1024*1024,previewEdge:1600,previewDataUrlChars:2_800_000,excerptChars:16000,envelopeBytes:24*1024*1024,envelopeNodes:100000 })
export const sourceRefSchema=z.object({documentId:contractIdSchema,extractionVersion:z.number().int().positive(),sectionId:contractIdSchema,page:z.number().int().positive().max(DOCUMENT_LIMITS.maxPages).optional(),start:z.number().int().nonnegative(),end:z.number().int().positive()}).strict().refine(ref=>ref.end>ref.start,'Source range must be nonempty and ordered')
export type SourceRef=z.infer<typeof sourceRefSchema>
export const documentSectionSchema=z.object({id:contractIdSchema,documentId:contractIdSchema,extractionVersion:z.number().int().positive(),page:z.number().int().positive().max(DOCUMENT_LIMITS.maxPages).optional(),title:z.string().max(500).optional(),text:z.string().max(DOCUMENT_LIMITS.sectionChars)}).strict()
export type DocumentSection=z.infer<typeof documentSectionSchema>
export const documentManifestSchema=z.object({
  id:contractIdSchema,name:z.string().min(1).max(500),mimeType:z.enum(['application/pdf','text/plain','text/markdown']),byteSize:z.number().int().nonnegative().max(DOCUMENT_LIMITS.maxBytes),sha256:z.string().regex(/^[a-f0-9]{64}$/i),extractionVersion:z.number().int().positive(),
  status:z.enum(['pending','extracting','ready','partial','failed']),pages:z.array(z.object({index:z.number().int().positive().max(DOCUMENT_LIMITS.maxPages),label:z.string().max(100).optional(),status:z.enum(['extracted','empty','failed']),sectionIds:z.array(contractIdSchema).max(DOCUMENT_LIMITS.maxSections)}).strict()).max(DOCUMENT_LIMITS.maxPages),
  warnings:z.array(z.string().max(500)).max(20),coverage:z.number().finite().min(0).max(1),createdAt:z.string().datetime()
}).strict().superRefine((value,ctx)=>{if(new Set(value.pages.map(page=>page.index)).size!==value.pages.length)ctx.addIssue({code:'custom',message:'Physical page indices must be unique'})})
export type DocumentManifest=z.infer<typeof documentManifestSchema>
export const sourceExcerptSchema=z.object({ref:sourceRefSchema,text:z.string().max(DOCUMENT_LIMITS.excerptChars),pageLabel:z.string().max(100).optional(),warnings:z.array(z.string().max(500)).max(20)}).strict()
export type SourceExcerpt=z.infer<typeof sourceExcerptSchema>
export const sourcePreviewSchema=z.object({documentId:contractIdSchema,page:z.number().int().positive().max(DOCUMENT_LIMITS.maxPages).optional(),pageLabel:z.string().max(100).optional(),caption:z.string().max(500),assetId:contractIdSchema.optional(),dataUrl:z.string().max(DOCUMENT_LIMITS.previewDataUrlChars).regex(/^data:image\/png;base64,[A-Za-z0-9+/]*={0,2}$/).optional(),text:z.string().max(DOCUMENT_LIMITS.excerptChars).optional(),warnings:z.array(z.string().max(500)).max(20)}).strict()
export type SourcePreview=z.infer<typeof sourcePreviewSchema>

/** Offsets are UTF-16 code units in this exact canonical extraction, never bytes. */
export function assertSourceRef(value:unknown,sections:readonly DocumentSection[]):SourceRef {
  const ref=sourceRefSchema.parse(value)
  const section=sections.find(item=>item.documentId===ref.documentId&&item.id===ref.sectionId&&item.extractionVersion===ref.extractionVersion)
  if(!section||ref.end>section.text.length||(ref.page!==undefined&&ref.page!==section.page))throw new Error('Source reference is outside the supplied extraction')
  const splitsPair=(offset:number)=>offset>0&&offset<section.text.length&&/[\uD800-\uDBFF]/.test(section.text[offset-1])&&/[\uDC00-\uDFFF]/.test(section.text[offset])
  if(splitsPair(ref.start)||splitsPair(ref.end))throw new Error('Source reference splits a UTF-16 character')
  return ref
}
