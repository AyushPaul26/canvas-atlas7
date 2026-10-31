// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SpatialScene } from '@living-canvas/protocol';
import * as THREE from 'three';
import type {OrbitControls} from 'three/addons/controls/OrbitControls.js';
const harness = vi.hoisted(() => ({ fail: false, reduced:false, durations:[] as number[], controls:[] as OrbitControls[], controlsDispose:vi.fn(), render: vi.fn(), dispose: vi.fn(), forceContextLoss: vi.fn() }));
vi.mock('three', async importOriginal => {
  const actual = await importOriginal<typeof import('three')>();
  return { ...actual, WebGLRenderer: class {
    renderLists = { dispose: vi.fn() }; setPixelRatio = vi.fn(); setClearColor = vi.fn(); setSize = vi.fn(); outputColorSpace = '';
    render = harness.render; dispose = harness.dispose; forceContextLoss = harness.forceContextLoss;
    constructor() { if (harness.fail) throw new Error('WebGL2 is unavailable'); }
  } };
});
vi.mock('three/addons/controls/OrbitControls.js',async importOriginal=>{
  const actual=await importOriginal<typeof import('three/addons/controls/OrbitControls.js')>();
  return {OrbitControls:class extends actual.OrbitControls{
    constructor(camera:THREE.Camera,element:HTMLElement){super(camera,element);harness.controls.push(this);}
    dispose(){harness.controlsDispose();super.dispose();}
  }};
});
vi.mock('motion/react',()=>({useReducedMotion:()=>harness.reduced,motion:{p:({initial:_initial,animate:_animate,transition, ...props}:React.ComponentProps<'p'>&{initial?:unknown;animate?:unknown;transition?:{duration:number}})=>{harness.durations.push(transition?.duration??0);return <p {...props}/>;}}}));
import Scene3D from './Scene3D';
const scene: SpatialScene = { nodes: [{ id: 'sphere', kind: 'sphere', position: [1,2,3], material: 'blue' }], camera: { position: [3,3,5], target: [0,0,0] }, fallbackDescription: 'A sphere and its position.' };
afterEach(() => { cleanup(); harness.fail = false; harness.reduced=false;harness.controls.length=0;harness.durations.length=0;vi.clearAllMocks(); vi.restoreAllMocks(); });
describe('trusted Three.js lifecycle', () => {
  it('renders accepted poses without an independent animation loop and disposes GPU resources', () => {
    const disposed = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose');
    const onReady = vi.fn(), onFailure = vi.fn();
    const view = render(<Scene3D scene={scene} onReady={onReady} onFailure={onFailure} />);
    expect(onReady).toHaveBeenCalledTimes(1); expect(onFailure).not.toHaveBeenCalled();
    const world = harness.render.mock.calls.at(-1)![0] as THREE.Scene;
    expect(world.getObjectByName('sphere')?.position.toArray()).toEqual([1,2,3]);
    const next: SpatialScene = { ...scene, nodes: [{ ...scene.nodes[0], position: [4,5,6] }] };
    view.rerender(<Scene3D scene={next} styles={{ sphere: { visible: true, highlighted: false, opacity: .4 } }} onReady={onReady} onFailure={onFailure} />);
    expect(world.getObjectByName('sphere')?.position.toArray()).toEqual([4,5,6]);
    expect((world.getObjectByName('sphere') as THREE.Mesh).material).toMatchObject({ opacity: .4 });
    view.unmount(); expect(disposed).toHaveBeenCalled(); expect(harness.dispose).toHaveBeenCalledTimes(1); expect(harness.forceContextLoss).toHaveBeenCalledTimes(1);
  });
  it('reports unavailable WebGL without acknowledging spatial readiness', () => {
    harness.fail = true; const onReady = vi.fn(), onFailure = vi.fn();
    render(<Scene3D scene={scene} onReady={onReady} onFailure={onFailure} />);
    expect(onFailure).toHaveBeenCalledWith('3D view unavailable: WebGL2 is unavailable'); expect(onReady).not.toHaveBeenCalled();
  });
  it('reports lost contexts and disposes the established renderer once', () => {
    const onFailure = vi.fn(); const view = render(<Scene3D scene={scene} onFailure={onFailure} />);
    fireEvent(view.container.querySelector('canvas')!, new Event('webglcontextlost', { cancelable: true }));
    expect(onFailure).toHaveBeenCalledWith('3D view unavailable: The graphics context was lost.');
    view.unmount(); expect(harness.dispose).toHaveBeenCalledTimes(1);
  });
  it('locks camera exploration while teaching and never starts damping or automatic rotation',()=>{
    render(<Scene3D scene={scene}/>);const controls=harness.controls[0];
    expect(controls.enabled).toBe(false);expect(controls.enableDamping).toBe(false);expect(controls.autoRotate).toBe(false);expect(controls.enablePan).toBe(false);
    expect((screen.getByRole('button',{name:'Rotate view left'}) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Pause teaching to rotate and zoom.')).toBeTruthy();
  });
  it('allows bounded keyboard/button exploration without changing accepted objects and resets the teacher view',()=>{
    const original=JSON.stringify(scene);const view=render(<Scene3D scene={scene} interactionEnabled viewKey="first"/>);
    const controls=harness.controls[0],camera=controls.object as THREE.PerspectiveCamera,initial=camera.position.clone();
    expect(controls.minDistance).toBeGreaterThan(0);expect(Number.isFinite(controls.maxDistance)).toBe(true);
    fireEvent.click(screen.getByRole('button',{name:'Rotate view left'}));expect(camera.position.distanceTo(initial)).toBeGreaterThan(.1);
    const viewport=screen.getByRole('group',{name:'3D exploration'});fireEvent.keyDown(viewport,{key:'ArrowUp'});fireEvent.keyDown(viewport,{key:'+'});
    expect(camera.position.distanceTo(controls.target)).toBeGreaterThanOrEqual(controls.minDistance);expect(camera.position.distanceTo(controls.target)).toBeLessThanOrEqual(controls.maxDistance);
    const world=harness.render.mock.calls.at(-1)![0] as THREE.Scene;expect(world.getObjectByName('sphere')?.position.toArray()).toEqual([1,2,3]);expect(JSON.stringify(scene)).toBe(original);
    for(let step=0;step<30;step++)fireEvent.keyDown(viewport,{key:'-'});
    expect(camera.position.distanceTo(controls.target)).toBeCloseTo(controls.maxDistance,8);
    for(let step=0;step<40;step++)fireEvent.keyDown(viewport,{key:'+'});
    expect(camera.position.distanceTo(controls.target)).toBeCloseTo(controls.minDistance,8);
    fireEvent.click(screen.getByRole('button',{name:'Reset 3D view'}));expect(camera.position.toArray()).toEqual(scene.camera.position);expect(controls.target.toArray()).toEqual(scene.camera.target);
    view.unmount();expect(harness.controlsDispose).toHaveBeenCalledTimes(1);
  });
  it('keeps a paused camera exploration across frame updates and restores it on resume or a new view',()=>{
    const view=render(<Scene3D scene={scene} interactionEnabled viewKey="first"/>),controls=harness.controls[0];
    fireEvent.click(screen.getByRole('button',{name:'Rotate view right'}));const explored=controls.object.position.clone();
    view.rerender(<Scene3D scene={{...scene,nodes:[{...scene.nodes[0],position:[4,5,6]}]}} interactionEnabled viewKey="first"/>);
    expect(controls.object.position.toArray()).toEqual(explored.toArray());
    view.rerender(<Scene3D scene={scene} viewKey="first"/>);expect(controls.object.position.toArray()).toEqual(scene.camera.position);expect(controls.enabled).toBe(false);
    view.rerender(<Scene3D scene={scene} interactionEnabled viewKey="first"/>);fireEvent.click(screen.getByRole('button',{name:'Rotate view right'}));
    view.rerender(<Scene3D scene={scene} interactionEnabled viewKey="second"/>);expect(controls.object.position.toArray()).toEqual(scene.camera.position);
  });
  it('draws pointer-controlled camera changes without an animation loop and removes controls on context loss',()=>{
    const view=render(<Scene3D scene={scene} interactionEnabled/>),controls=harness.controls[0];const before=harness.render.mock.calls.length;
    controls.object.position.set(4,2,6);controls.dispatchEvent({type:'change'});
    expect(harness.render.mock.calls.length).toBeGreaterThan(before);expect(controls.object.position.toArray()).toEqual([4,2,6]);
    fireEvent(view.container.querySelector('canvas')!,new Event('webglcontextlost',{cancelable:true}));expect(harness.controlsDispose).toHaveBeenCalledTimes(1);
    view.unmount();expect(harness.controlsDispose).toHaveBeenCalledTimes(1);
  });
  it('renders escaped anchored labels with a readable legend and hides labels behind the camera',()=>{
    const labeled:SpatialScene={nodes:[{id:'front',kind:'sphere',position:[0,0,0],material:'blue',label:'<img src=x onerror=alert(1)>'},{id:'behind',kind:'sphere',position:[0,0,10],material:'green',label:'Behind the camera'}],camera:{position:[0,0,5],target:[0,0,0]},fallbackDescription:'Two labeled objects.'};
    const view=render(<Scene3D scene={labeled}/>);
    expect(view.container.querySelector('img')).toBeNull();expect(screen.getByText('Object labels · 2')).toBeTruthy();
    expect((view.container.querySelector('[data-node-id="front"]') as HTMLElement).hidden).toBe(false);expect((view.container.querySelector('[data-node-id="behind"]') as HTMLElement).hidden).toBe(true);
    expect(screen.getAllByText('<img src=x onerror=alert(1)>').length).toBeGreaterThan(0);
  });
  it('disables supporting UI transitions when reduced motion is requested',()=>{
    harness.reduced=true;render(<Scene3D scene={scene}/>);expect(harness.durations.length).toBeGreaterThan(0);expect(harness.durations.every(duration=>duration===0)).toBe(true);
  });
  it('does not redraw accepted objects while an idle exploration is waiting for learner input',()=>{
    vi.useFakeTimers();try{
      render(<Scene3D scene={scene} interactionEnabled/>);const count=harness.render.mock.calls.length;
      vi.advanceTimersByTime(2000);expect(harness.render.mock.calls.length).toBe(count);
    }finally{vi.useRealTimers();}
  });
});
