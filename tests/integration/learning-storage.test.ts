import { describe,it,expect } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync,rmSync,existsSync,copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionRepository } from '../../apps/desktop/src/main/storage/session-repository'
import { openDatabase } from '../../apps/desktop/src/main/storage/database'

const plan={id:'plan',version:1,title:'Topic',sourceDocumentIds:[],concepts:[{id:'concept',title:'Concept',objectives:['Explain'],prerequisiteIds:[],sourceRefs:[]}]}
const beat={id:'beat',conceptId:'concept',narration:'First. Second.',canvas:{mode:'replace' as const,entities:[{id:'x',kind:'text' as const,x:0,y:0,text:'Original'}]},chunks:[{id:'one',text:'First. '},{id:'two',text:'Second.'}],cues:[]}
const checkpoint={cursor:{beatId:'beat',chunkId:'one',offsetSeconds:0,passId:'pass'},completedChunkIds:['one'],appliedCueIds:[],baselineScene:beat.canvas.entities,visibleScene:[]}

function versionOne(path:string,broken=false){
  const db=new DatabaseSync(path)
  try{
  // Include every table in the actual v1 schema; an incomplete fixture can fail
  // ordinary reads after migration and leave its open database blocking cleanup.
  db.exec(`CREATE TABLE sessions(id TEXT PRIMARY KEY,topic TEXT NOT NULL,title TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,snapshot TEXT NOT NULL,event_seq INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE events(session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,seq INTEGER NOT NULL,created_at TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(session_id,seq));
    CREATE TABLE scene_snapshots(session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,revision INTEGER NOT NULL DEFAULT 0,payload TEXT NOT NULL);
    CREATE TABLE program_versions(session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,hash TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(session_id,hash));
    CREATE TABLE playback_checkpoints(session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,payload TEXT NOT NULL);
    CREATE TABLE learner_evidence(id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,observed TEXT NOT NULL,inference TEXT,created_at TEXT NOT NULL);
    CREATE TABLE preferences(key TEXT PRIMARY KEY,value TEXT NOT NULL); PRAGMA user_version=1;`)
  const lesson={id:'legacy',title:'Saved',topic:'Topic',createdAt:'2020-01-01',updatedAt:'2020-01-01',messages:[],beats:[{id:'old',narration:'Old narration',canvas:{mode:'replace',entities:[]}}],scene:[],controls:{}}
  db.prepare('INSERT INTO sessions VALUES(?,?,?,?,?,?,?)').run('legacy','Topic','Saved','2020-01-01','2020-01-01',JSON.stringify(lesson),1)
  db.prepare('INSERT INTO events VALUES(?,?,?,?)').run('legacy',1,'2020-01-01','{"type":"old-event"}')
  if(broken)db.exec('CREATE TABLE courses(conflict TEXT)')
  }finally{db.close()}
}

describe('learning persistence',()=>{
  it('migrates a copy of version one atomically and preserves lessons without invented evidence',()=>{
    const dir=mkdtempSync(join(tmpdir(),'atlas-migration-'))
    try{
      const fixture=join(dir,'v1.sqlite'),path=join(dir,'copy.sqlite');versionOne(fixture);copyFileSync(fixture,path)
      const store=new SessionRepository(path)
      try{
      expect((store.db.prepare('PRAGMA user_version').get() as any).user_version).toBe(2)
      expect(store.events('legacy')).toEqual([{type:'old-event'}])
      expect(store.load('legacy').beats[0].narration).toBe('Old narration')
      expect(store.readLearnerEvidence('legacy')).toEqual([])
      expect((store as any).loadPlayback('legacy')).toBeUndefined()
      expect(existsSync(`${path}.v1.bak`)).toBe(true)
      }finally{store.close()}
      const original=new DatabaseSync(fixture)
      try{expect((original.prepare('PRAGMA user_version').get() as any).user_version).toBe(1)}finally{original.close()}
    }finally{rmSync(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100})}
  })
  it('rolls back every v2 table when migration fails partway and refuses newer schemas',()=>{
    const dir=mkdtempSync(join(tmpdir(),'atlas-rollback-'))
    try{
      const path=join(dir,'v1.sqlite');versionOne(path,true)
      expect(()=>openDatabase(path)).toThrow()
      const db=new DatabaseSync(path)
      try{
      expect((db.prepare('PRAGMA user_version').get() as any).user_version).toBe(1)
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name='documents'").get()).toBeUndefined()
      expect(db.prepare('SELECT COUNT(*) AS n FROM events').get()).toMatchObject({n:1})
      db.exec('PRAGMA user_version=99')
      }finally{db.close()}
      expect(()=>openDatabase(path)).toThrow(/newer/i)
    }finally{rmSync(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100})}
  })
  it('keeps accepted beats immutable and validates acknowledged playback before any write',()=>{
    const store=new SessionRepository(':memory:')
    try{
      const session=store.create('Topic')
      expect((store as any).savePlan).toBeTypeOf('function')
      ;(store as any).savePlan(session.id,plan);store.commitBeat(session.id,beat)
      expect(()=>store.commitBeat(session.id,{...beat,narration:'Altered',chunks:[{id:'one',text:'Altered'}]})).toThrow(/immutable|accepted/i)
      store.presentProgress(session.id,beat,{epoch:1,scene:[],narration:'First. ',complete:false})
      expect((store as any).loadAcceptedBeat(session.id,'beat').narration).toBe('First. Second.')
      ;(store as any).savePlayback(session.id,checkpoint)
      expect((store as any).loadPlayback(session.id)).toEqual(checkpoint)
      expect(()=>(store as any).savePlayback(session.id,{...checkpoint,completedChunkIds:['unknown']})).toThrow()
      expect((store as any).loadPlayback(session.id)).toEqual(checkpoint)
      expect(()=>store.transaction(()=>{(store as any).savePlayback(session.id,{...checkpoint,completedChunkIds:['one','two']});throw new Error('disk failure')})).toThrow('disk failure')
      expect((store as any).loadPlayback(session.id)).toEqual(checkpoint)
    }finally{store.close()}
  })
  it('does not advance covered concepts without complete audio and visual acknowledgements',()=>{
    const store=new SessionRepository(':memory:')
    try{
      const session=store.create('Topic');(store as any).savePlan(session.id,plan);store.commitBeat(session.id,beat)
      const progress={planId:'plan',planVersion:1,activeConceptId:'concept',conceptStates:{concept:'completed'},status:'completed'}
      expect(()=>(store as any).saveLearningProgress(session.id,progress)).toThrow(/acknowledged/i)
      const receipt={beatId:'beat',planId:'plan',planVersion:1,passId:'pass',completedChunkIds:['one','two'],appliedCueIds:[],audioResult:'paused',visualComplete:true}
      expect(()=>(store as any).savePlayback(session.id,{...checkpoint,completedChunkIds:['one','two'],receipt,progress})).toThrow(/acknowledged/i)
      expect((store as any).loadPlayback(session.id)).toBeUndefined()
      ;(store as any).savePlayback(session.id,{...checkpoint,completedChunkIds:['one','two'],receipt:{...receipt,audioResult:'completed'},progress})
      expect((store as any).loadLearningProgress(session.id).conceptStates).toEqual({concept:'completed'})
      expect(()=>(store as any).saveLearningProgress(session.id,{...progress,conceptStates:{concept:'teaching'}})).toThrow(/erase/i)
    }finally{store.close()}
  })
  it('saves source snapshots and courses on a shared database and rolls back failed document replacement',async()=>{
    const documents=await import('../../apps/desktop/src/main/storage/document-repository').catch(()=>undefined)
    const courses=await import('../../apps/desktop/src/main/storage/course-repository').catch(()=>undefined)
    expect(documents?.DocumentRepository).toBeTypeOf('function');expect(courses?.CourseRepository).toBeTypeOf('function')
    const store=new SessionRepository(':memory:')
    try{
      const documentStore=new documents!.DocumentRepository(store.db),courseStore=new courses!.CourseRepository(store.db)
      const manifest={id:'doc',name:'Source.txt',mimeType:'text/plain' as const,byteSize:4,sha256:'a'.repeat(64),extractionVersion:1,status:'ready' as const,pages:[],warnings:[],coverage:1,createdAt:new Date().toISOString()}
      const section={id:'section',documentId:'doc',extractionVersion:1,text:'A😀B'}
      documentStore.saveDocument(manifest,[section])
      const ref={documentId:'doc',extractionVersion:1,sectionId:'section',start:1,end:3}
      const sourcedPlan={...plan,sourceDocumentIds:['doc'],concepts:[{...plan.concepts[0],sourceRefs:[ref]}]}
      const course=courseStore.createCourse(sourcedPlan,['doc'])
      expect(courseStore.loadCourse(course.id)?.plan.concepts[0].sourceRefs).toEqual([ref])
      const session=store.create('Topic');courseStore.linkSession(course.id,session.id)
      expect(courseStore.loadCourse(course.id)?.sessionIds).toEqual([session.id])
      store.db.exec("CREATE TRIGGER fail_sections BEFORE INSERT ON document_sections BEGIN SELECT RAISE(ABORT,'disk full'); END")
      expect(()=>documentStore.saveDocument({...manifest,name:'Changed'},[section])).toThrow('disk full')
      expect(documentStore.loadDocument('doc')?.manifest.name).toBe('Source.txt')
      expect(documentStore.getSections('doc')).toEqual([section])
      expect(()=>courseStore.createCourse({...sourcedPlan,id:'wrong',concepts:[{...sourcedPlan.concepts[0],sourceRefs:[{...ref,end:99}]}]},['doc'])).toThrow()
    }finally{store.close()}
  })
})
