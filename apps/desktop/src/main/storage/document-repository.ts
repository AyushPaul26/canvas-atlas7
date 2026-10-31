import type {DatabaseSync} from 'node:sqlite'
import {assertBoundedJson,assertSourceRef,documentManifestSchema,documentSectionSchema,DOCUMENT_LIMITS,type DocumentManifest,type DocumentSection,type SourceRef} from '@living-canvas/protocol'
import {checkDatabaseVersion,databaseTransaction} from './database'

/** Shares the application's connection; original bytes/assets remain in private files. */
export class DocumentRepository {
  constructor(readonly db:DatabaseSync){checkDatabaseVersion(db)}
  saveDocument(input:DocumentManifest,inputSections:DocumentSection[]):void {
    const manifest=documentManifestSchema.parse(input),sections=inputSections.map(section=>documentSectionSchema.parse(section))
    if(sections.length>DOCUMENT_LIMITS.maxSections||sections.reduce((total,section)=>total+section.text.length,0)>DOCUMENT_LIMITS.totalTextChars)throw new Error('Document extraction exceeds its text budget.')
    assertBoundedJson(JSON.stringify({manifest,sections}),DOCUMENT_LIMITS.envelopeBytes,{maxNodes:DOCUMENT_LIMITS.envelopeNodes})
    if(new Set(sections.map(section=>section.id)).size!==sections.length||sections.some(section=>section.documentId!==manifest.id||section.extractionVersion!==manifest.extractionVersion))throw new Error('Sections must belong to this exact document extraction and have unique IDs.')
    for(const page of manifest.pages)if(page.sectionIds.some(id=>!sections.some(section=>section.id===id&&section.page===page.index)))throw new Error('Page references an unknown section.')
    for(const section of sections)if(section.page!==undefined&&!manifest.pages.some(page=>page.index===section.page&&page.sectionIds.includes(section.id)))throw new Error('Section references an unknown physical page.')
    databaseTransaction(this.db,()=>{
      const previous=this.loadDocument(manifest.id)?.manifest
      if(previous&&manifest.extractionVersion<previous.extractionVersion)throw new Error('Cannot replace a document with an older extraction.')
      this.db.prepare('INSERT INTO documents(id,payload) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(manifest.id,JSON.stringify(manifest))
      for(const section of sections){
        const old=this.db.prepare('SELECT payload FROM document_sections WHERE document_id=? AND extraction_version=? AND id=?').get(manifest.id,manifest.extractionVersion,section.id) as {payload:string}|undefined
        if(old&&old.payload!==JSON.stringify(section))throw new Error('A canonical source extraction is immutable. Increase its extraction version.')
        this.db.prepare('INSERT OR IGNORE INTO document_sections(document_id,extraction_version,id,payload) VALUES(?,?,?,?)').run(manifest.id,manifest.extractionVersion,section.id,JSON.stringify(section))
      }
    })
  }
  loadDocument(id:string):{manifest:DocumentManifest;sections:DocumentSection[]}|undefined {
    checkDatabaseVersion(this.db);const row=this.db.prepare('SELECT payload FROM documents WHERE id=?').get(id) as {payload:string}|undefined
    if(!row)return undefined
    const manifest=documentManifestSchema.parse(JSON.parse(row.payload));return {manifest,sections:this.getSections(id,manifest.extractionVersion)}
  }
  listDocuments():DocumentManifest[]{checkDatabaseVersion(this.db);return (this.db.prepare('SELECT payload FROM documents ORDER BY rowid DESC').all() as {payload:string}[]).map(row=>documentManifestSchema.parse(JSON.parse(row.payload)))}
  getSections(id:string,extractionVersion?:number):DocumentSection[]{
    checkDatabaseVersion(this.db)
    if(extractionVersion===undefined){const row=this.db.prepare('SELECT payload FROM documents WHERE id=?').get(id) as {payload:string}|undefined;if(!row)return [];extractionVersion=documentManifestSchema.parse(JSON.parse(row.payload)).extractionVersion}
    return (this.db.prepare('SELECT payload FROM document_sections WHERE document_id=? AND extraction_version=? ORDER BY rowid').all(id,extractionVersion) as {payload:string}[]).map(row=>documentSectionSchema.parse(JSON.parse(row.payload)))
  }
  assertSourceRef(ref:SourceRef):SourceRef{return assertSourceRef(ref,this.getSections(ref.documentId,ref.extractionVersion))}
}
