import { describe, expect, it } from 'vitest'
import * as protocol from '../../packages/protocol/src/index'

const plan = { id:'plan',version:1,title:'A topic',sourceDocumentIds:[],concepts:[{id:'a',title:'First',objectives:['Explain it'],prerequisiteIds:[],sourceRefs:[]}] }
const beat = { id:'beat',narration:'First. Second.',canvas:{mode:'replace' as const,entities:[{id:'node',kind:'text' as const,x:0,y:0,text:'Visible'}]},chunks:[{id:'first',text:'First. '},{id:'second',text:'Second.'}],cues:[{id:'cue',chunkId:'second',at:'start' as const,action:{type:'visibility' as const,targetId:'node',visible:true}}] }

describe('learning contracts',()=>{
  it('rejects duplicate, missing and cyclic concept identifiers',()=>{
    const schema=(protocol as any).learningPlanSchema
    expect(schema).toBeDefined()
    expect(schema.safeParse(plan).success).toBe(true)
    expect(schema.safeParse({...plan,concepts:[plan.concepts[0],plan.concepts[0]]}).success).toBe(false)
    expect(schema.safeParse({...plan,concepts:[{...plan.concepts[0],prerequisiteIds:['missing']}]}).success).toBe(false)
    expect(schema.safeParse({...plan,concepts:[{...plan.concepts[0],prerequisiteIds:['b']},{...plan.concepts[0],id:'b',prerequisiteIds:['a']}]}).success).toBe(false)
  })
  it('validates exact narration, cue references and finite values',()=>{
    expect(()=>protocol.parseTeachingBeat(beat)).not.toThrow()
    expect(()=>protocol.parseTeachingBeat({...beat,chunks:[{id:'first',text:'Different'}]})).toThrow()
    expect(()=>protocol.parseTeachingBeat({...beat,cues:[{...beat.cues[0],chunkId:'missing'}]})).toThrow()
    expect(()=>protocol.parseTeachingBeat({...beat,cues:[{...beat.cues[0],action:{type:'visibility',targetId:'missing',visible:true}}]})).toThrow()
    expect(()=>protocol.parseTeachingBeat({...beat,cues:[{...beat.cues[0],at:Infinity}]})).toThrow()
    expect(()=>protocol.parseTeachingBeat({...beat,cues:[{...beat.cues[0],action:{type:'experiment',controlId:'missing',value:1}}]})).toThrow()
  })
  it('adapts full legacy narration deterministically without invented cues',()=>{
    const legacy={id:'legacy',narration:('Sentence with a long word. ').repeat(250).slice(0,8000),canvas:beat.canvas}
    const adapt=(protocol as any).adaptTeachingBeat
    expect(adapt).toBeTypeOf('function')
    const adapted=adapt(legacy)
    expect(adapted.chunks.map((chunk:any)=>chunk.text).join('')).toBe(legacy.narration)
    expect(adapted).toEqual(adapt(legacy))
    expect(adapted.cues).toEqual([])
    expect(adapted.canvas).toEqual(legacy.canvas)
  })
  it('verifies UTF16 ranges against the exact document extraction',()=>{
    const validate=(protocol as any).assertSourceRef
    expect(validate).toBeTypeOf('function')
    const sections=[{id:'section',documentId:'doc',extractionVersion:1,page:1,text:'A😀B'}]
    const ref={documentId:'doc',extractionVersion:1,sectionId:'section',page:1,start:1,end:3}
    expect(()=>validate(ref,sections)).not.toThrow()
    expect(()=>validate({...ref,end:5},sections)).toThrow()
    expect(()=>validate({...ref,extractionVersion:2},sections)).toThrow()
    expect(()=>validate({...ref,start:2},sections)).toThrow()
  })
  it('rejects aggregate source and playback envelopes rather than reducing scene allowances',()=>{
    const schema=(protocol as any).playbackCheckpointSchema
    expect(schema).toBeDefined()
    const checkpoint={cursor:{beatId:'beat',chunkId:'first',offsetSeconds:0,passId:'pass'},completedChunkIds:[],appliedCueIds:[],baselineScene:[],visibleScene:[]}
    expect(schema.safeParse(checkpoint).success).toBe(true)
    expect(schema.safeParse({...checkpoint,cursor:{...checkpoint.cursor,offsetSeconds:NaN}}).success).toBe(false)
    expect(schema.safeParse({...checkpoint,baselineScene:Array.from({length:2000},(_,i)=>({id:`a${i}`,kind:'text',x:0,y:0,text:'文'.repeat(4000)}))}).success).toBe(false)
  })
})
