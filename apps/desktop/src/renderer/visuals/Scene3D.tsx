import {useId,useLayoutEffect,useRef} from 'react';
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {motion,useReducedMotion} from 'motion/react';
import {ArrowDown,ArrowLeft,ArrowRight,ArrowUp,Minus,Plus,RotateCcw} from 'lucide-react';
import type {SpatialScene} from '@living-canvas/protocol';
import type {VisualCamera,VisualFrame} from '@living-canvas/scene';
import {createSpatialObject,disposeSpatialObject,spatialObjectKey,updateSpatialObject} from './visual-adapters';
import './spatial-view.css';

export type Scene3DProps={scene:SpatialScene;styles?:VisualFrame['spatialStyles'];camera?:VisualCamera;interactionEnabled?:boolean;viewKey?:string;onReady?:()=>void;onFailure?:(message:string)=>void};
type ViewAction='left'|'right'|'up'|'down'|'in'|'out'|'reset';
type Runtime={draw:()=>void;adjust:(action:ViewAction)=>void;dispose:()=>void};
const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));

/** Accepted poses follow audio frames. Camera exploration is local and draws
 * only in response to learner input; it never changes lesson checkpoints. */
export default function Scene3D({scene,styles={},camera,interactionEnabled=false,viewKey='',onReady,onFailure}:Scene3DProps){
  const host=useRef<HTMLDivElement>(null),runtime=useRef<Runtime|undefined>(undefined),labels=useRef(new Map<string,HTMLSpanElement>());
  const callbacks=useRef({onReady,onFailure});callbacks.current={onReady,onFailure};
  const latest=useRef({scene,styles,camera,interactionEnabled,viewKey});latest.current={scene,styles,camera,interactionEnabled,viewKey};
  const hintId=useId(),reduceMotion=useReducedMotion();
  const labeled=scene.nodes.filter(node=>node.label&&styles[node.id]?.visible!==false&&(styles[node.id]?.opacity??1)>.05);
  useLayoutEffect(()=>{
    const element=host.current;if(!element)return;
    let renderer:THREE.WebGLRenderer|undefined,controls:OrbitControls|undefined,observer:ResizeObserver|undefined;
    let disposed=false,drawing=false,initialized=false,wasInteractive=false,acceptedKey='',resetRequested=false;
    const fail=(cause:unknown)=>{
      if(disposed)return;
      const message=cause instanceof Error?cause.message:String(cause);
      runtime.current?.dispose();runtime.current=undefined;callbacks.current.onFailure?.(`3D view unavailable: ${message}`);
    };
    const lost=(event:Event)=>{event.preventDefault();fail('The graphics context was lost.');};
    try{
      const canvas=document.createElement('canvas');canvas.setAttribute('aria-hidden','true');canvas.style.width='100%';canvas.style.height='100%';canvas.style.display='block';
      canvas.addEventListener('webglcontextlost',lost);
      renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true,powerPreference:'low-power'});
      renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));renderer.setClearColor('#F5F7FA',1);renderer.outputColorSpace=THREE.SRGBColorSpace;
      const world=new THREE.Scene();world.add(new THREE.HemisphereLight('#ffffff','#667185',2.2));
      const light=new THREE.DirectionalLight('#ffffff',2.5);light.position.set(5,8,6);world.add(light);
      const viewpoint=new THREE.PerspectiveCamera(45,1,.01,5_000_000),objects=new Map<string,THREE.Object3D>();
      controls=new OrbitControls(viewpoint,canvas);controls.enableDamping=false;controls.autoRotate=false;controls.enablePan=false;controls.enabled=false;
      controls.minPolarAngle=.05;controls.maxPolarAngle=Math.PI-.05;
      const activeControls=controls,activeRenderer=renderer;
      const restoreTeacherView=()=>{
        const accepted=latest.current,position=new THREE.Vector3().fromArray(accepted.scene.camera.position),target=new THREE.Vector3().fromArray(accepted.scene.camera.target);
        if(position.distanceToSquared(target)<.0001)position.z+=5;
        const distance=position.distanceTo(target);activeControls.minDistance=Math.max(.05,distance*.25);activeControls.maxDistance=Math.max(distance,Math.min(4_000_000,distance*4));
        viewpoint.position.copy(position);activeControls.target.copy(target);activeControls.update();
        // Preserve the exact accepted pose after the control's spherical math.
        viewpoint.position.copy(position);viewpoint.lookAt(target);viewpoint.zoom=accepted.camera?.zoom??1;
      };
      const draw=()=>{
        if(disposed||drawing)return;drawing=true;
        try{
          const accepted=latest.current,ids=new Set(accepted.scene.nodes.map(node=>node.id));
          for(const [id,object] of objects)if(!ids.has(id)){disposeSpatialObject(object);objects.delete(id);}
          for(const node of accepted.scene.nodes){
            let object=objects.get(node.id);
            if(object&&object.userData.primitiveKey!==spatialObjectKey(node)){disposeSpatialObject(object);objects.delete(node.id);object=undefined;}
            if(!object){object=createSpatialObject(node);objects.set(node.id,object);world.add(object);}
            updateSpatialObject(object,node,accepted.styles[node.id]);
          }
          if(!initialized||!accepted.interactionEnabled||!wasInteractive||acceptedKey!==accepted.viewKey||resetRequested)restoreTeacherView();
          initialized=true;wasInteractive=accepted.interactionEnabled;acceptedKey=accepted.viewKey;resetRequested=false;
          activeControls.enabled=accepted.interactionEnabled;canvas.style.touchAction=accepted.interactionEnabled?'none':'pan-y';
          const width=Math.max(1,element.clientWidth||640),height=Math.max(1,element.clientHeight||260);
          if(accepted.camera)viewpoint.setViewOffset(width,height,accepted.camera.x,accepted.camera.y,width,height);else viewpoint.clearViewOffset();
          viewpoint.aspect=width/height;viewpoint.updateProjectionMatrix();viewpoint.updateMatrixWorld();
          activeRenderer.setSize(width,height,false);activeRenderer.render(world,viewpoint);
          for(const label of labels.current.values())label.hidden=true;
          const occupied:Array<{left:number;top:number;right:number;bottom:number}>=[];
          const ordered=accepted.scene.nodes.filter(node=>node.label).sort((a,b)=>Number(accepted.styles[b.id]?.highlighted??false)-Number(accepted.styles[a.id]?.highlighted??false));
          for(const node of ordered){
            const label=labels.current.get(node.id),style=accepted.styles[node.id];if(!label||style?.visible===false||(style?.opacity??1)<=.05||occupied.length>=12)continue;
            const point=new THREE.Vector3().fromArray(node.position).project(viewpoint);
            if(![point.x,point.y,point.z].every(Number.isFinite)||point.z< -1||point.z>1||Math.abs(point.x)>1||Math.abs(point.y)>1)continue;
            const labelWidth=Math.min(180,width-16,Math.max(72,24+(node.label?.length??0)*6.5)),x=clamp((point.x+1)*width/2,labelWidth/2+8,width-labelWidth/2-8);
            const origin=clamp((1-point.y)*height/2-26,8,height-28);
            for(const offset of [0,-28,28,-56,56]){
              const y=origin+offset;if(y<8||y+24>height-4)continue;
              const box={left:x-labelWidth/2,top:y,right:x+labelWidth/2,bottom:y+24};
              if(occupied.some(other=>box.left<other.right+4&&box.right>other.left-4&&box.top<other.bottom+4&&box.bottom>other.top-4))continue;
              label.style.left=`${x}px`;label.style.top=`${y}px`;label.style.maxWidth=`${labelWidth}px`;label.hidden=false;occupied.push(box);break;
            }
          }
        }catch(cause){fail(cause);}finally{drawing=false;}
      };
      const changed=()=>draw();activeControls.addEventListener('change',changed);
      const adjust=(action:ViewAction)=>{
        if(disposed||!latest.current.interactionEnabled)return;
        if(action==='reset'){resetRequested=true;draw();return;}
        const offset=viewpoint.position.clone().sub(activeControls.target),spherical=new THREE.Spherical().setFromVector3(offset),angle=Math.PI/12;
        if(action==='left')spherical.theta-=angle;if(action==='right')spherical.theta+=angle;
        if(action==='up')spherical.phi-=angle;if(action==='down')spherical.phi+=angle;
        if(action==='in')spherical.radius*=.8;if(action==='out')spherical.radius/=.8;
        spherical.phi=clamp(spherical.phi,activeControls.minPolarAngle,activeControls.maxPolarAngle);spherical.radius=clamp(spherical.radius,activeControls.minDistance,activeControls.maxDistance);
        viewpoint.position.copy(activeControls.target).add(new THREE.Vector3().setFromSpherical(spherical));activeControls.update();draw();
      };
      const dispose=()=>{
        if(disposed)return;disposed=true;observer?.disconnect();window.removeEventListener('resize',draw);canvas.removeEventListener('webglcontextlost',lost);
        activeControls.removeEventListener('change',changed);activeControls.dispose();
        for(const object of objects.values())disposeSpatialObject(object);objects.clear();for(const label of labels.current.values())label.hidden=true;
        activeRenderer.renderLists.dispose();activeRenderer.dispose();activeRenderer.forceContextLoss();canvas.remove();
      };
      runtime.current={draw,adjust,dispose};element.prepend(canvas);
      if(typeof ResizeObserver!=='undefined'){observer=new ResizeObserver(draw);observer.observe(element);}else window.addEventListener('resize',draw);
      draw();if(!disposed)callbacks.current.onReady?.();return()=>{dispose();runtime.current=undefined;};
    }catch(cause){controls?.dispose();renderer?.dispose();fail(cause);}
  },[]);
  useLayoutEffect(()=>{runtime.current?.draw();},[scene,styles,camera,interactionEnabled,viewKey]);
  const adjust=(action:ViewAction)=>runtime.current?.adjust(action);
  return <section className="spatial-view" aria-label="3D learning view">
    <div className="spatial-view-toolbar"><span>3D view</span><div role="group" aria-label="3D camera controls">
      <button type="button" className="icon-button" aria-label="Rotate view left" title="Rotate left" disabled={!interactionEnabled} onClick={()=>adjust('left')}><ArrowLeft size={15}/></button>
      <button type="button" className="icon-button" aria-label="Rotate view right" title="Rotate right" disabled={!interactionEnabled} onClick={()=>adjust('right')}><ArrowRight size={15}/></button>
      <button type="button" className="icon-button" aria-label="Rotate view up" title="Rotate up" disabled={!interactionEnabled} onClick={()=>adjust('up')}><ArrowUp size={15}/></button>
      <button type="button" className="icon-button" aria-label="Rotate view down" title="Rotate down" disabled={!interactionEnabled} onClick={()=>adjust('down')}><ArrowDown size={15}/></button>
      <button type="button" className="icon-button" aria-label="Zoom 3D view in" title="Zoom in" disabled={!interactionEnabled} onClick={()=>adjust('in')}><Plus size={15}/></button>
      <button type="button" className="icon-button" aria-label="Zoom 3D view out" title="Zoom out" disabled={!interactionEnabled} onClick={()=>adjust('out')}><Minus size={15}/></button>
      <button type="button" className="button secondary compact" aria-label="Reset 3D view" disabled={!interactionEnabled} onClick={()=>adjust('reset')}><RotateCcw size={13}/>Reset view</button>
    </div></div>
    <div className="spatial-view-input" role="group" aria-label="3D exploration" aria-describedby={hintId} tabIndex={interactionEnabled?0:-1} onKeyDown={event=>{
      if(!interactionEnabled||event.ctrlKey||event.metaKey||event.altKey)return;
      const action:ViewAction|undefined=({'ArrowLeft':'left','ArrowRight':'right','ArrowUp':'up','ArrowDown':'down','+':'in','=':'in','-':'out','Home':'reset'} as Record<string,ViewAction>)[event.key];
      if(action){event.preventDefault();adjust(action);}
    }}><div ref={host} className={`spatial-view-viewport ${interactionEnabled?'can-explore':''}`} role="img" aria-label={scene.fallbackDescription}><div className="spatial-view-labels" aria-hidden="true">{labeled.map(node=><span key={node.id} className="spatial-view-label" data-node-id={node.id} title={node.label} ref={element=>{if(element)labels.current.set(node.id,element);else labels.current.delete(node.id);}}><b>{scene.nodes.indexOf(node)+1}</b><span>{node.label}</span></span>)}</div></div></div>
    <motion.p key={interactionEnabled?'explore':'teacher'} id={hintId} className="spatial-view-hint" initial={{opacity:reduceMotion?1:0}} animate={{opacity:1}} transition={{duration:reduceMotion?0:.12}}>{interactionEnabled?'Drag to rotate · Scroll to zoom · Arrow keys also work.':'Pause teaching to rotate and zoom.'}</motion.p>
    {labeled.length>0&&<details className="spatial-view-legend"><summary>Object labels · {labeled.length}</summary><ol>{labeled.map(node=><li key={node.id} value={scene.nodes.indexOf(node)+1}>{node.label}</li>)}</ol></details>}
  </section>;
}
