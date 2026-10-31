import Matter from 'matter-js';
import {LIMITS,controlSchema,parseScene,type Control,type SceneEntity,type SimulationResult} from '../../protocol/src/index.ts';
import {physicsModelSchema,validatePhysicsBindings,type PhysicsModel} from '../../protocol/src/physics-model.ts';
import type {ModelSession,ModelValues} from './model-contract';

/** Matter is trusted bundled code. The model supplies bounded data only. */
export function createPhysicsModelSession(input:PhysicsModel,controls:Control[],initialValues:ModelValues):ModelSession{
  const model=physicsModelSchema.parse(input);validatePhysicsBindings(model,controls);
  const ppm=model.pixelsPerMeter,engine=Matter.Engine.create({enableSleeping:false,positionIterations:6,velocityIterations:4,constraintIterations:2});
  engine.gravity={...model.gravity,scale:ppm/1_000_000};
  const bodies=new Map<string,Matter.Body>(),forces=new Map<string,{x:number;y:number}>(),joints:Array<{id:string;constraint:Matter.Constraint}>=[];
  let tick=0,disposed=false,values:ModelValues={};
  const alive=()=>{if(disposed)throw new Error('This mechanics model has closed. Reset it to continue.');};
  const validate=(next:ModelValues)=>{
    if(Object.keys(next).some(id=>!controls.some(control=>control.id===id)))throw new Error('Unknown mechanics control.');
    const checked:ModelValues={};
    for(const control of controls){const value=Object.hasOwn(next,control.id)?next[control.id]:Object.hasOwn(values,control.id)?values[control.id]:control.value;controlSchema.parse({...control,value});checked[control.id]=value;}
    return checked;
  };
  const apply=(next:ModelValues,all=false)=>{
    for(const binding of model.bindings){
      if(!all&&next[binding.controlId]===values[binding.controlId])continue;
      const value=next[binding.controlId] as number,body=binding.bodyId?bodies.get(binding.bodyId)!:undefined;
      if(binding.target==='gravityX')engine.gravity.x=value;
      else if(binding.target==='gravityY')engine.gravity.y=value;
      else if(binding.target==='mass')Matter.Body.setMass(body!,value);
      else if(binding.target==='friction')body!.friction=value;
      else if(binding.target==='restitution')body!.restitution=value;
      else if(binding.target==='velocityX'||binding.target==='velocityY')Matter.Body.setVelocity(body!,{x:binding.target==='velocityX'?value*ppm/60:body!.velocity.x,y:binding.target==='velocityY'?value*ppm/60:body!.velocity.y});
      else{const force=forces.get(binding.bodyId!)!;if(binding.target==='forceX')force.x=value;else force.y=value;}
    }
    values=next;
  };
  const frame=():SimulationResult=>{
    alive();let energy=0,momentumX=0,momentumY=0;
    const states:Array<{id:string;x:number;y:number;vx:number;vy:number;angle:number;angularVelocity:number;mass:number|null}>=[],entities:SceneEntity[]=[];
    for(const definition of model.bodies){
      const body=bodies.get(definition.id)!,x=body.position.x/ppm,y=body.position.y/ppm,vx=body.velocity.x*60/ppm,vy=body.velocity.y*60/ppm;
      if(![x,y,vx,vy,body.angle,body.angularVelocity].every(Number.isFinite)||Math.abs(x)>1000||Math.abs(y)>1000)throw new Error('The mechanics model left its supported numerical range. Reset it to continue.');
      states.push({id:definition.id,x,y,vx,vy,angle:body.angle,angularVelocity:body.angularVelocity*60,mass:definition.isStatic?null:body.mass});
      if(!definition.isStatic){energy+=.5*body.mass*(vx*vx+vy*vy);momentumX+=body.mass*vx;momentumY+=body.mass*vy;}
      const paint={stroke:definition.color,fill:definition.color,strokeWidth:2};
      if(definition.shape==='circle')entities.push({id:`body:${definition.id}`,kind:'circle',x:100+body.position.x,y:80+body.position.y,radius:definition.radius!*ppm,...paint});
      else{const width=definition.width!*ppm,height=definition.height!*ppm,cos=Math.cos(body.angle),sin=Math.sin(body.angle);entities.push({id:`body:${definition.id}`,kind:'rect',x:100+body.position.x-cos*width/2+sin*height/2,y:80+body.position.y-sin*width/2-cos*height/2,width,height,rotation:body.angle*180/Math.PI,...paint});}
      if(definition.label)entities.push({id:`label:${definition.id}`,kind:'text',x:100+body.position.x+8,y:80+body.position.y-24,text:definition.label,fontSize:16,stroke:'#18243B'});
    }
    for(const {id,constraint} of joints){const a=constraint.pointA??{x:0,y:0},b=constraint.pointB??{x:0,y:0};entities.push({id:`joint:${id}`,kind:'line',x:100,y:80,points:[a.x+(constraint.bodyA?.position.x??0),a.y+(constraint.bodyA?.position.y??0),b.x+(constraint.bodyB?.position.x??0),b.y+(constraint.bodyB?.position.y??0)],stroke:'#667185',strokeWidth:2});}
    const measurements={time_s:tick*LIMITS.fixedDt,translational_energy_J:energy,momentum_x_kg_m_s:momentumX,momentum_y_kg_m_s:momentumY};
    if(!Object.values(measurements).every(Number.isFinite))throw new Error('The mechanics model returned invalid measurements.');
    return {state:{version:1,kind:'physics',tick,bodies:states},entities:parseScene(entities),measurements};
  };
  const dispose=()=>{if(disposed)return;disposed=true;Matter.Composite.clear(engine.world,false);Matter.Engine.clear(engine);bodies.clear();forces.clear();joints.length=0;};
  try{
    for(const definition of model.bodies){
      const options={isStatic:definition.isStatic,friction:definition.friction,frictionAir:definition.frictionAir,restitution:definition.restitution,angle:definition.angle,slop:.05};
      const body=definition.shape==='circle'?Matter.Bodies.circle(definition.x*ppm,definition.y*ppm,definition.radius!*ppm,options):Matter.Bodies.rectangle(definition.x*ppm,definition.y*ppm,definition.width!*ppm,definition.height!*ppm,options);
      if(!definition.isStatic)Matter.Body.setMass(body,definition.mass);
      Matter.Body.setVelocity(body,{x:definition.vx*ppm/60,y:definition.vy*ppm/60});Matter.Body.setAngularVelocity(body,definition.angularVelocity/60);
      bodies.set(definition.id,body);forces.set(definition.id,{x:0,y:0});Matter.Composite.add(engine.world,body);
    }
    for(const definition of model.joints){
      const scaled=(point:{x:number;y:number}|undefined,bodyId?:string)=>{const x=(point?.x??0)*ppm,y=(point?.y??0)*ppm,angle=bodyId?bodies.get(bodyId)!.angle:0;return {x:x*Math.cos(angle)-y*Math.sin(angle),y:x*Math.sin(angle)+y*Math.cos(angle)};};
      const constraint=Matter.Constraint.create({bodyA:bodies.get(definition.bodyA),...(definition.bodyB?{bodyB:bodies.get(definition.bodyB)}:{}),pointA:scaled(definition.pointA,definition.bodyA),pointB:scaled(definition.pointB,definition.bodyB),...(definition.length!==undefined?{length:definition.length*ppm}:{}),stiffness:definition.stiffness,damping:definition.damping});
      joints.push({id:definition.id,constraint});Matter.Composite.add(engine.world,constraint);
    }
    apply(validate(initialValues),true);frame();
    return {
      step(){alive();if(tick>=36000)throw new Error('This mechanics model reached its saved playback limit. Reset it to continue.');for(const [id,force] of forces){const body=bodies.get(id)!;if(!body.isStatic)Matter.Body.applyForce(body,body.position,{x:force.x*ppm/1_000_000,y:force.y*ppm/1_000_000});}Matter.Engine.update(engine,1000*LIMITS.fixedDt);tick++;return frame();},
      input(next){alive();const checked=validate(next);apply(checked);return frame();},render:frame,dispose,
    };
  }catch(error){dispose();throw error;}
}
