import * as THREE from 'three';
import type { SpatialScene } from '@living-canvas/protocol';

export type SpatialNode = SpatialScene['nodes'][number];
export type SpatialStyle = { visible: boolean; opacity: number; highlighted: boolean };
const palette: Record<SpatialNode['material'], string> = { neutral: '#667185', blue: '#7775E7', green: '#72AD94', orange: '#DE9B54', red: '#B13D4D', purple: '#5754BD', wireframe: '#18243B' };
export const spatialObjectKey = (node: SpatialNode) => `${node.kind}:${node.segments ?? 16}`;

/** Closed bundled primitives only. No loader, external asset, shader or generated code path. */
export function createSpatialObject(node: SpatialNode): THREE.Object3D {
  const segments = Math.max(3, Math.min(128, node.segments ?? 16));
  let object: THREE.Object3D;
  if (node.kind === 'arrow') {
    object = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 1, palette[node.material], .22, .12);
    // ArrowHelper shares its geometry globally; own our buffers so disposal cannot break siblings.
    object.traverse(child => { const mesh = child as THREE.Mesh; if (mesh.geometry) mesh.geometry = mesh.geometry.clone(); });
  } else if (node.kind === 'line') {
    object = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(1, 0, 0)]), new THREE.LineBasicMaterial({ color: palette[node.material] }));
  } else {
    const geometry = node.kind === 'sphere' ? new THREE.SphereGeometry(.5, segments, segments)
      : node.kind === 'cylinder' ? new THREE.CylinderGeometry(.5, .5, 1, segments)
      : node.kind === 'cone' ? new THREE.ConeGeometry(.5, 1, segments)
      : node.kind === 'plane' ? new THREE.PlaneGeometry(1, 1)
      : new THREE.BoxGeometry(1, 1, 1);
    object = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: palette[node.material], roughness: .8, metalness: 0, wireframe: node.material === 'wireframe', side: THREE.DoubleSide }));
  }
  object.name = node.id;
  object.userData.primitiveKey = spatialObjectKey(node);
  updateSpatialObject(object, node);
  return object;
}

export function updateSpatialObject(object: THREE.Object3D, node: SpatialNode, style: SpatialStyle = { visible: true, opacity: 1, highlighted: false }): void {
  object.position.fromArray(node.position);
  object.rotation.set(...(node.rotation ?? [0, 0, 0]));
  object.scale.fromArray(node.scale ?? [1, 1, 1]);
  object.visible = style.visible;
  object.traverse(child => {
    const renderable = child as THREE.Mesh;
    if (!renderable.material) return;
    for (const material of Array.isArray(renderable.material) ? renderable.material : [renderable.material]) {
      const colored = material as THREE.MeshStandardMaterial;
      colored.color?.set(style.highlighted ? '#7775E7' : palette[node.material]);
      const transparent = style.opacity < 1;
      if (colored.transparent !== transparent) { colored.transparent = transparent; material.needsUpdate = true; }
      colored.opacity = style.opacity;
      colored.depthWrite = style.opacity >= 1;
      if ('emissive' in colored) { colored.emissive.set(style.highlighted ? '#5754BD' : '#000000'); colored.emissiveIntensity = style.highlighted ? .3 : 0; }
    }
  });
}

export function disposeSpatialObject(object: THREE.Object3D): void {
  object.traverse(child => {
    const renderable = child as THREE.Mesh;
    renderable.geometry?.dispose();
    for (const material of Array.isArray(renderable.material) ? renderable.material : renderable.material ? [renderable.material] : []) material.dispose();
  });
  object.removeFromParent();
}
