import {describe,it,expect} from 'vitest';
import type {Control} from '@living-canvas/protocol';
import {physicsModelSchema,validatePhysicsBindings} from '../../packages/protocol/src/physics-model';
import {createPhysicsModelSession} from '../../packages/simulation/src/physics-model';

const definition=()=>({version:1,kind:'physics',gravity:{x:0,y:0},bodies:[{id:'ball',shape:'circle',x:1,y:1,radius:.2,mass:2,vx:1,vy:0,frictionAir:0}],joints:[],bindings:[]});
const force:Control={id:'force',label:'Horizontal force',type:'slider',value:4,min:-10,max:10,step:1,unit:'N'};
const state=(session:ReturnType<typeof createPhysicsModelSession>)=>session.render().state as {tick:number;bodies:Array<{id:string;x:number;y:number;vx:number;vy:number}>};
describe('trusted physics model schema and kernel',()=>{
  it('admits only bounded body data and resolves required defaults',()=>{
    const model=physicsModelSchema.parse(definition());expect(model.pixelsPerMeter).toBe(80);expect(model.bodies[0].restitution).toBe(.5);
    expect(physicsModelSchema.safeParse({...definition(),plugins:['arbitrary-code']}).success).toBe(false);
    expect(physicsModelSchema.safeParse({...definition(),bodies:Array.from({length:33},(_,i)=>({...definition().bodies[0],id:`body-${i}`}))}).success).toBe(false);
    expect(physicsModelSchema.safeParse({...definition(),bodies:[...definition().bodies,...definition().bodies]}).success).toBe(false);
    expect(physicsModelSchema.safeParse({...definition(),joints:[{id:'joint',bodyA:'missing'}]}).success).toBe(false);
  });
  it('validates control references, physical ranges and duplicate targets before admission',()=>{
    const model=physicsModelSchema.parse({...definition(),bindings:[{controlId:'force',target:'forceX',bodyId:'ball'}]});expect(()=>validatePhysicsBindings(model,[force])).not.toThrow();
    expect(()=>validatePhysicsBindings(model,[])).toThrow();
    expect(()=>validatePhysicsBindings(model,[{...force,min:-10001,max:10001}])).toThrow();
    expect(()=>validatePhysicsBindings(physicsModelSchema.parse(definition()),[force])).toThrow();
    expect(physicsModelSchema.safeParse({...definition(),bindings:[{controlId:'f',target:'mass'}]}).success).toBe(false);
    expect(physicsModelSchema.safeParse({...definition(),bindings:[{controlId:'f',target:'forceX',bodyId:'missing'}]}).success).toBe(false);
  });
  it('advances exactly one fixed second using metre and m/s units',()=>{
    const session=createPhysicsModelSession(physicsModelSchema.parse(definition()),[],{});
    try{for(let i=0;i<60;i++)session.step();expect(state(session).tick).toBe(60);expect(state(session).bodies[0].x).toBeCloseTo(2,8);expect(state(session).bodies[0].y).toBeCloseTo(1,8);expect(state(session).bodies[0].vx).toBeCloseTo(1,8);expect(session.render().measurements?.time_s).toBe(1);expect(()=>JSON.stringify(session.render())).not.toThrow();}finally{session.dispose();}
  });
  it('applies uniform gravity and reports finite physical measurements',()=>{
    const model=physicsModelSchema.parse({...definition(),gravity:{x:0,y:9.81}}),session=createPhysicsModelSession(model,[],{});
    try{for(let i=0;i<60;i++)session.step();expect(state(session).bodies[0].y).toBeCloseTo(1+9.81*61/120,6);expect(state(session).bodies[0].vy).toBeCloseTo(9.81,6);expect(session.render().measurements?.momentum_x_kg_m_s).toBeCloseTo(2,6);expect(session.render().entities).toHaveLength(1);}finally{session.dispose();}
  });
  it('applies a bound force with F=ma and rejects control updates atomically',()=>{
    const model=physicsModelSchema.parse({...definition(),bodies:[{...definition().bodies[0],vx:0}],bindings:[{controlId:'force',target:'forceX',bodyId:'ball'}]}),session=createPhysicsModelSession(model,[force],{force:4});
    try{for(let i=0;i<60;i++)session.step();expect(state(session).bodies[0].vx).toBeCloseTo(2,6);const before=session.render();expect(()=>session.input({force:100})).toThrow();expect(()=>session.input({force:null} as any)).toThrow();expect(session.render()).toEqual(before);session.input({force:0});for(let i=0;i<60;i++)session.step();expect(state(session).bodies[0].vx).toBeCloseTo(2,6);}finally{session.dispose();}
  });
  it('keeps collisions, joints and reset runs reproducible without serializing Matter internals',()=>{
    const model=physicsModelSchema.parse({...definition(),gravity:{x:0,y:9.81},bodies:[{...definition().bodies[0],vx:0},{id:'floor',shape:'rect',x:3,y:4,width:8,height:.2,isStatic:true}]});
    const first=createPhysicsModelSession(model,[],{}),second=createPhysicsModelSession(model,[],{});
    try{for(let i=0;i<180;i++){first.step();second.step();}expect(first.render()).toEqual(second.render());expect(state(first).bodies[0].y).toBeLessThan(3.71);expect(first.render().entities.some(entity=>entity.kind==='rect')).toBe(true);expect(JSON.stringify(first.render())).not.toMatch(/collisionFilter|positionPrev|pairs/);}finally{first.dispose();second.dispose();}
  });
  it('keeps body, label and joint frame IDs distinct even when source IDs resemble derived names',()=>{
    const model=physicsModelSchema.parse({...definition(),bodies:[{...definition().bodies[0],label:'Ball'},{...definition().bodies[0],id:'ball.label'}]});
    const session=createPhysicsModelSession(model,[],{});try{expect(session.render().entities).toHaveLength(3);expect(new Set(session.render().entities.map(entity=>entity.id)).size).toBe(3);}finally{session.dispose();}
  });
  it('rotates local joint attachment points with an initially rotated body',()=>{
    const model=physicsModelSchema.parse({...definition(),bodies:[{id:'bar',shape:'rect',x:1,y:1,width:2,height:.2,angle:Math.PI/2}],joints:[{id:'hinge',bodyA:'bar',pointA:{x:1,y:0},pointB:{x:1,y:2},length:0}]});
    const session=createPhysicsModelSession(model,[],{});try{const points=session.render().entities.find(entity=>entity.kind==='line')!.points!;expect(points[0]).toBeCloseTo(80,8);expect(points[1]).toBeCloseTo(160,8);}finally{session.dispose();}
  });
});
