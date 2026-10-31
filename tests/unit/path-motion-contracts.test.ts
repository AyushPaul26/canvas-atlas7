import {describe,expect,it} from 'vitest';
import {parseTeachingBeat,visualCueSchema} from '../../packages/protocol/src/index';
import {buildTeacherInstructions,getTeachingToolParameters} from '../../packages/teacher/src/index';
import {geminiTools} from '../../apps/desktop/src/main/ai/gemini-tools';
import {groqTools} from '../../apps/desktop/src/main/ai/groq-tools';

const path={id:'motion',chunkId:'sentence',at:'start',action:{type:'path',targetId:'earth',points:[{x:10,y:20},{x:80,y:40},{x:120,y:10}],durationMs:1500}};
describe('bounded declarative path motion',()=>{
  it('accepts a path in the canonical teaching beat and preserves the points',()=>{
    const beat=parseTeachingBeat({id:'orbit',narration:'Earth follows its orbit.',chunks:[{id:'sentence',text:'Earth follows its orbit.'}],cues:[path],canvas:{mode:'replace',entities:[{id:'earth',kind:'circle',x:10,y:20,radius:8}]}});
    expect(beat.cues?.[0]).toEqual(path);
  });
  it.each([
    {points:[]}, {points:[{x:0,y:0}]}, {points:Array.from({length:65},()=>({x:0,y:0}))},
    {points:[{x:0,y:0},{x:Infinity,y:0}]}, {points:[{x:0,y:0},{x:0,y:NaN}]},
    {points:[{x:0,y:0},{x:1_000_001,y:0}]}, {points:[{x:0,y:0},{x:0,y:-1_000_001}]},
    {points:[{x:0,y:0},{x:'https://example.com',y:0}]}, {durationMs:-1}, {durationMs:60001}, {durationMs:Infinity}, {source:'alert(1)'},
  ])('rejects an unbounded or executable path action %#',invalid=>{
    expect(visualCueSchema.safeParse({...path,action:{...path.action,...invalid}}).success).toBe(false);
  });
  it('exports the bounded action through the strict provider tool schema',()=>{
    const schema=getTeachingToolParameters() as any;
    const action=schema.properties.cues.anyOf[0].items.properties.action.anyOf.find((branch:any)=>branch.properties?.type?.const==='path');
    expect(action).toBeTruthy();expect(action.required).toEqual(['type','targetId','points','durationMs']);expect(action.additionalProperties).toBe(false);
    expect(action.properties.points).toMatchObject({minItems:2,maxItems:64,items:{type:'object',required:['x','y'],additionalProperties:false}});
    const propertyCount=(value:unknown):number=>{
      if(!value||typeof value!=='object')return 0;
      const node=value as Record<string,unknown>;
      return (node.properties?Object.keys(node.properties as object).length:0)+Object.values(node).reduce<number>((sum,child)=>sum+propertyCount(child),0);
    };
    expect(propertyCount(schema)).toBeLessThanOrEqual(100);
  });
  it('asks for explanatory motion instead of decorative movement',()=>{
    const instructions=buildTeacherInstructions();
    expect(instructions).toContain('type:"path"');expect(instructions).toMatch(/motion.*default.*change/is);expect(instructions).toMatch(/decorative.*(?:wobble|movement)/i);
  });
  it('retains the same path schema through Gemini and Groq teaching tool adapters',()=>{
    const parameters=getTeachingToolParameters(),tools=[{type:'namespace',name:'teaching',tools:[{type:'function',name:'present_beat',strict:true,parameters}]}];
    expect(geminiTools(tools)[0]).toMatchObject({parameters});
    expect(groqTools(tools).tools[0]).toMatchObject({function:{parameters}});
  });
});
