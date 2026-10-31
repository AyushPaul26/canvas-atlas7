import { describe,expect,it } from 'vitest'
import { assertBoundedJson,parseScene,parseTeachingBeat,playbackCheckpointSchema,simulationCheckpointSchema } from '../../packages/protocol/src/index'

describe('additive playback envelope',()=>{
  it('accepts two independently valid scenes and simulation history exceeding 373,000 aggregate nodes',()=>{
    // 2,000 entities with nine properties and 99,000 points total: 119,001 nodes each.
    const scene=Array.from({length:2000},(_,index)=>({id:`e${index}`,kind:'path' as const,x:0,y:0,width:1,height:1,text:'x',label:'x',points:Array.from({length:index<1000?50:49},()=>0)}))
    const controls=Array.from({length:32},(_,index)=>({id:`c${index}`,label:`Control ${index}`,type:'number' as const,value:0}))
    const values=Object.fromEntries(controls.map(control=>[control.id,0]))
    const simulation={artifact:{id:'sim',title:'Experiment',source:'globalThis.simulation={}',controls,assumptions:[],validation:'illustrative' as const},state:Array.from({length:99998},()=>0),tick:1000,values,initialValues:values,inputs:Array.from({length:1000},(_,tick)=>({tick,values}))}
    const checkpoint={cursor:{beatId:'dense',chunkId:'chunk',offsetSeconds:0,passId:'pass'},completedChunkIds:[],appliedCueIds:[],baselineScene:scene,visibleScene:scene,simulation}

    expect(()=>parseScene(scene)).not.toThrow()
    expect(()=>parseTeachingBeat({id:'dense',narration:'x',chunks:[{id:'chunk',text:'x'}],canvas:{mode:'replace',entities:scene}})).not.toThrow()
    expect(simulationCheckpointSchema.safeParse(simulation).success).toBe(true)
    expect(()=>assertBoundedJson(JSON.stringify(checkpoint),9*1024*1024,{maxNodes:373000})).toThrow(/complex/i)
    expect(playbackCheckpointSchema.safeParse(checkpoint).success).toBe(true)
  })
})
