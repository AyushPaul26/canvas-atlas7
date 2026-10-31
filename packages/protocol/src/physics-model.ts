import {z} from 'zod';
import {controlSchema,type Control} from './core';

const id=z.string().min(1).max(80).regex(/^[A-Za-z][\w.-]*$/);
const position=z.number().finite().min(-100).max(100);
const positive=z.number().finite().min(.01).max(50);
const point=z.object({x:position,y:position}).strict();
const body=z.object({
  id,shape:z.enum(['circle','rect']),x:position,y:position,
  radius:positive.optional(),width:positive.optional(),height:positive.optional(),
  mass:z.number().finite().min(.01).max(1000).default(1),
  vx:z.number().finite().min(-100).max(100).default(0),vy:z.number().finite().min(-100).max(100).default(0),
  angle:z.number().finite().min(-Math.PI*2).max(Math.PI*2).default(0),angularVelocity:z.number().finite().min(-100).max(100).default(0),
  friction:z.number().finite().min(0).max(1).default(.1),frictionAir:z.number().finite().min(0).max(1).default(0),restitution:z.number().finite().min(0).max(1).default(.5),
  isStatic:z.boolean().default(false),color:z.string().regex(/^#[\da-fA-F]{6}$/).default('#7775E7'),label:z.string().max(80).optional(),
}).strict().superRefine((value,context)=>{
  if(value.shape==='circle'&&(!value.radius||value.width!==undefined||value.height!==undefined))context.addIssue({code:'custom',message:'A circle needs only its radius.'});
  if(value.shape==='rect'&&(!value.width||!value.height||value.radius!==undefined))context.addIssue({code:'custom',message:'A rectangle needs only width and height.'});
});
const joint=z.object({id,bodyA:id,bodyB:id.optional(),pointA:point.optional(),pointB:point.optional(),length:z.number().finite().min(0).max(200).optional(),stiffness:z.number().finite().min(0).max(1).default(1),damping:z.number().finite().min(0).max(1).default(0)}).strict();
export const physicsTargetRanges={gravityX:[-50,50],gravityY:[-50,50],mass:[.01,1000],friction:[0,1],restitution:[0,1],velocityX:[-100,100],velocityY:[-100,100],forceX:[-1000,1000],forceY:[-1000,1000]} as const;
const binding=z.object({controlId:z.string().min(1).max(160).regex(/^[\w:.-]+$/),target:z.enum(['gravityX','gravityY','mass','friction','restitution','velocityX','velocityY','forceX','forceY']),bodyId:id.optional()}).strict();
export const physicsModelSchema=z.object({
  version:z.literal(1),kind:z.literal('physics'),pixelsPerMeter:z.number().finite().min(10).max(300).default(80),
  gravity:z.object({x:z.number().finite().min(-50).max(50),y:z.number().finite().min(-50).max(50)}).strict().default({x:0,y:9.81}),
  bodies:z.array(body).min(1).max(32),joints:z.array(joint).max(32).default([]),bindings:z.array(binding).max(32).default([]),
}).strict().superRefine((model,context)=>{
  const ids=new Set(model.bodies.map(item=>item.id)),jointIds=new Set(model.joints.map(item=>item.id)),targets=new Set<string>();
  if(ids.size!==model.bodies.length||jointIds.size!==model.joints.length)context.addIssue({code:'custom',message:'Physics object IDs must be unique.'});
  for(const item of model.joints)if(!ids.has(item.bodyA)||item.bodyB&&!ids.has(item.bodyB)||item.bodyA===item.bodyB)context.addIssue({code:'custom',message:'Joint body references must identify distinct existing bodies.'});
  for(const item of model.bindings){
    const gravity=item.target==='gravityX'||item.target==='gravityY',target=`${item.target}:${item.bodyId??''}`;
    if(gravity?item.bodyId!==undefined:!item.bodyId||!ids.has(item.bodyId))context.addIssue({code:'custom',message:'Physics binding needs a valid target.'});
    if(!gravity&&model.bodies.find(body=>body.id===item.bodyId)?.isStatic)context.addIssue({code:'custom',message:'Only dynamic bodies accept physics controls.'});
    if(targets.has(target))context.addIssue({code:'custom',message:'Physics controls cannot overwrite the same target.'});targets.add(target);
  }
});
export type PhysicsModel=z.infer<typeof physicsModelSchema>;

export function validatePhysicsBindings(model:PhysicsModel,controls:Control[]):void{
  if(controls.length>32||new Set(controls.map(control=>control.id)).size!==controls.length)throw new Error('Physics controls must be unique and bounded.');
  const known=new Map(controls.map(control=>[control.id,controlSchema.parse(control)])),used=new Set<string>();
  for(const binding of model.bindings){
    const control=known.get(binding.controlId),[min,max]=physicsTargetRanges[binding.target];
    if(!control||!['slider','number'].includes(control.type)||typeof control.value!=='number'||control.min===undefined||control.max===undefined||control.min<min||control.max>max)throw new Error('Physics controls need numeric ranges within the target’s physical limits.');
    used.add(control.id);
  }
  if(controls.some(control=>!used.has(control.id)))throw new Error('Every physics control must be bound to a supported model property.');
}
