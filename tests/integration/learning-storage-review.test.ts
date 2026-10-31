import { describe,expect,it } from 'vitest'
import { existsSync,mkdtempSync,rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionRepository } from '../../apps/desktop/src/main/storage/session-repository'
import { adaptTeachingBeat,type PlaybackCheckpoint,type SceneEntity,type TeachingBeat } from '../../packages/protocol/src/index'

const legacyBeat:TeachingBeat={id:'legacy-beat',narration:'A saved explanation.',canvas:{mode:'replace',entities:[{id:'a',kind:'text',x:0,y:0,text:'Original'}]}}

describe('reviewed learning storage boundaries',()=>{
  it('saves no-plan legacy completion receipts only for the accepted beat and pass without roadmap advancement',()=>{
    const store=new SessionRepository(':memory:')
    try{
      const session=store.create('Legacy lesson');store.commitBeat(session.id,legacyBeat)
      const chunks=adaptTeachingBeat(legacyBeat).chunks.map(chunk=>chunk.id)
      const checkpoint:PlaybackCheckpoint={cursor:{beatId:legacyBeat.id,chunkId:chunks[0],offsetSeconds:0,passId:'pass'},completedChunkIds:chunks,appliedCueIds:[],baselineScene:legacyBeat.canvas.entities,visibleScene:legacyBeat.canvas.entities,receipt:{beatId:legacyBeat.id,planId:'legacy',planVersion:1,passId:'pass',completedChunkIds:chunks,appliedCueIds:[],audioResult:'completed',visualComplete:true}}
      expect(()=>store.savePlayback(session.id,checkpoint)).not.toThrow()
      expect(store.loadPlayback(session.id)).toEqual(checkpoint)
      expect(store.loadLearningProgress(session.id)).toBeUndefined()
      for(const receipt of [
        {...checkpoint.receipt!,planId:'unknown'},
        {...checkpoint.receipt!,planVersion:2},
        {...checkpoint.receipt!,beatId:'another-beat'},
        {...checkpoint.receipt!,passId:'another-pass'}
      ])expect(()=>store.savePlayback(session.id,{...checkpoint,receipt})).toThrow()
      expect(()=>store.savePlayback(session.id,{...checkpoint,cursor:{...checkpoint.cursor,beatId:'not-accepted'},receipt:{...checkpoint.receipt!,beatId:'not-accepted'}})).toThrow(/accepted/i)
      expect(()=>store.savePlayback(session.id,{...checkpoint,progress:{planId:'legacy',planVersion:1,activeConceptId:'concept',conceptStates:{concept:'completed'},status:'completed'}})).toThrow(/no learning plan/i)
      expect(store.loadPlayback(session.id)).toEqual(checkpoint)
      expect(store.loadLearningProgress(session.id)).toBeUndefined()
      store.savePlan(session.id,{id:'actual-plan',version:1,title:'Topic',sourceDocumentIds:[],concepts:[{id:'concept',title:'Concept',objectives:['Explain'],prerequisiteIds:[],sourceRefs:[]}]})
      expect(()=>store.savePlayback(session.id,checkpoint)).toThrow(/plan version/i)
    }finally{store.close()}
  })

  it.each(['append','update'] as const)('replays a queued replace/%s staged baseline in stable order with preserved properties and no learner notes',mode=>{
    const directory=mkdtempSync(join(tmpdir(),'atlas-queued-baseline-')),path=join(directory,'lessons.sqlite')
    let store:SessionRepository|undefined
    try{
      store=new SessionRepository(path);const session=store.create('Queued presentation')
      const note:SceneEntity={id:'note',kind:'text',x:30,y:30,text:'My note',semanticRole:'learner-note'}
      store.saveScene(session.id,[{id:'stale',kind:'text',x:0,y:0,text:'Previous board'},note])
      const first:TeachingBeat={id:'first',narration:'First.',canvas:{mode:'replace',entities:[{id:'a',kind:'text',x:10,y:20,text:'Keep this text',stroke:'#123'},{id:'c',kind:'circle',x:40,y:40,radius:8}]}}
      const second:TeachingBeat={id:'second',narration:'Second.',canvas:{mode,entities:[{id:'a',kind:'text',x:11,y:21},{id:'b',kind:'rect',x:50,y:50,width:10,height:12}]}}
      const staged:SceneEntity[]=[{id:'a',kind:'text',x:11,y:21,text:'Keep this text',stroke:'#123'},{id:'c',kind:'circle',x:40,y:40,radius:8},{id:'b',kind:'rect',x:50,y:50,width:10,height:12}]
      store.commitBeat(session.id,first,first.canvas.entities)
      store.commitBeat(session.id,second,staged)
      expect(store.load(session.id).beats).toEqual([])
      expect(store.loadAcceptedBaseline(session.id,'second')).toEqual(staged)
      const chunk=adaptTeachingBeat(second).chunks[0].id
      store.savePlayback(session.id,{cursor:{beatId:'second',chunkId:chunk,offsetSeconds:0,passId:'replay'},completedChunkIds:[],appliedCueIds:[],baselineScene:staged,visibleScene:staged})
      store.close();store=new SessionRepository(path)
      expect(store.loadAcceptedBaseline(session.id,'second')).toEqual(staged)
      expect(store.loadAcceptedBeat(session.id,'second')?.canvas.mode).toBe(mode)
      expect(store.loadPlayback(session.id)?.baselineScene.map(entity=>entity.id)).toEqual(['a','c','b'])
      expect(store.loadPlayback(session.id)?.baselineScene[0]).toEqual({id:'a',kind:'text',x:11,y:21,text:'Keep this text',stroke:'#123'})
      expect(store.loadPlayback(session.id)?.baselineScene.some(entity=>entity.semanticRole==='learner-note')).toBe(false)
    }finally{store?.close();rmSync(directory,{recursive:true,force:true,maxRetries:10,retryDelay:50})}
  })

  it('rejects invalid supplied baseline scenes before accepting a beat or recording preparation',()=>{
    const store=new SessionRepository(':memory:')
    try{
      const session=store.create('Invalid baseline')
      expect(()=>store.commitBeat(session.id,legacyBeat,[{id:'bad',kind:'text',x:Infinity,y:0}])).toThrow()
      expect(store.loadAcceptedBeat(session.id,legacyBeat.id)).toBeUndefined()
      expect(store.events(session.id)).toEqual([])
      expect(()=>store.commitBeat(session.id,legacyBeat,[...legacyBeat.canvas.entities,...legacyBeat.canvas.entities])).toThrow(/unique/i)
    }finally{store.close()}
  })

  it('does not create a v1 backup for a fresh on-disk database',()=>{
    const directory=mkdtempSync(join(tmpdir(),'atlas-fresh-database-')),path=join(directory,'lessons.sqlite')
    let store:SessionRepository|undefined
    try{store=new SessionRepository(path);expect(existsSync(`${path}.v1.bak`)).toBe(false);expect(store.create('Fresh').topic).toBe('Fresh')}
    finally{store?.close();rmSync(directory,{recursive:true,force:true})}
  })
})
