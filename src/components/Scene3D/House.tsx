// House model — OWNED by Dev A
// Procedural low-poly architectural mockup, driven by Dev D's analysis.json.
// The raw 3D Tiles photogrammetric mesh is NEVER rendered to the user.
//
// Style: cream toon volume + crisp black edge lines (drei <Edges>, which uses
// THREE.EdgesGeometry under the hood). We deliberately avoid drei <Outlines>
// because the inverted-hull technique it implements only works on closed
// watertight meshes — open roof planes break it visually.

'use client';

import { useMemo } from 'react';
import { Edges } from '@react-three/drei';
import { BufferAttribute, BufferGeometry } from 'three';
import { useHouseGeometry } from './HouseGeometry';
import type { RoofFace as RoofFaceT } from '@/lib/types';

export const COLOR_WALL = '#f5f1ea';
export const COLOR_ROOF = '#c14a3a';
export const COLOR_GABLE = '#ece6d8';
export const COLOR_GROUND = '#fafafa';
export const COLOR_OBSTRUCTION = '#8d6748';
export const EDGE_COLOR = '#111111';
// Angle threshold (in degrees) above which an edge between two faces is drawn.
// 15° catches the hard architectural edges and skips the smooth-shaded curves.
export const EDGE_THRESHOLD = 15;

export function House() {
  const { width, depth, wallHeight, faces, obstructions } = useHouseGeometry();

  return (
    <group>
      {/* Walls — closed box, edges are well-defined */}
      <mesh position={[0, wallHeight / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[width, wallHeight, depth]} />
        <meshToonMaterial color={COLOR_WALL} />
        <Edges threshold={EDGE_THRESHOLD} color={EDGE_COLOR} lineWidth={1.5} />
      </mesh>

      {/* Gable triangles — close the volume between wall top and roof ridge so
          the interior is never visible from low angles. Two thin walls flush
          with the front and back facades, peaking at the same height as the
          ridge derived from the analysis faces (or default if missing). */}
      <Gables width={width} depth={depth} wallHeight={wallHeight} faces={faces} />

      {/* Roof — driven by analysis.faces if present, else a default symmetric hip */}
      {faces.length > 0 ? (
        faces.map((face) => <RoofFace key={face.id} face={face} />)
      ) : (
        <DefaultRoof width={width} depth={depth} wallHeight={wallHeight} />
      )}

      {/* Obstructions (chimneys, dormers) */}
      {obstructions.map((obs) => (
        <mesh
          key={obs.id}
          position={[obs.position[0], obs.position[1], obs.position[2]]}
          castShadow
        >
          <boxGeometry args={[obs.radius * 1.6, 1.2, obs.radius * 1.6]} />
          <meshToonMaterial color={COLOR_OBSTRUCTION} />
          <Edges threshold={EDGE_THRESHOLD} color={EDGE_COLOR} lineWidth={1.5} />
        </mesh>
      ))}

      {/* Ground plane — light, receives the contact shadow from Scene3D */}
      <mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[60, 60]} />
        <meshToonMaterial color={COLOR_GROUND} />
      </mesh>
    </group>
  );
}

// One roof face from analysis.json — vertices are in mesh-local coords.
function RoofFace({ face }: { face: RoofFaceT }) {
  const geometry = useMemo(() => {
    const v = face.vertices;
    if (v.length < 3) return null;

    const indices =
      v.length === 4
        ? [0, 1, 2, 0, 2, 3]
        : v.length === 3
          ? [0, 1, 2]
          : Array.from({ length: v.length - 2 }, (_, i) => [0, i + 1, i + 2]).flat();

    const geom = new BufferGeometry();
    geom.setAttribute('position', new BufferAttribute(new Float32Array(v.flat()), 3));
    geom.setIndex(indices);
    // Critical for both lighting and any post effect that samples normals.
    geom.computeVertexNormals();
    return geom;
  }, [face.vertices]);

  if (!geometry) return null;

  return (
    <mesh geometry={geometry} castShadow receiveShadow>
      <meshToonMaterial color={COLOR_ROOF} side={2} />
      <Edges threshold={EDGE_THRESHOLD} color={EDGE_COLOR} lineWidth={1.5} />
    </mesh>
  );
}

// Triangular gables on the front and back facades. They sit between wallHeight
// and the highest vertex of the analysis faces, sealing the volume so the
// interior is never visible.
function Gables({
  width,
  depth,
  wallHeight,
  faces,
}: {
  width: number;
  depth: number;
  wallHeight: number;
  faces: RoofFaceT[];
}) {
  const ridgeHeight = useMemo(() => {
    if (faces.length === 0) return wallHeight + 1.6;
    let maxY = wallHeight;
    for (const face of faces) {
      for (const v of face.vertices) {
        if (v[1] > maxY) maxY = v[1];
      }
    }
    return maxY;
  }, [faces, wallHeight]);

  const triangleGeom = useMemo(() => {
    const halfW = width / 2;
    // Triangle vertices: bottom-left, bottom-right, peak-center (in XY plane, z=0)
    const positions = new Float32Array([
      -halfW, wallHeight, 0,
      halfW, wallHeight, 0,
      0, ridgeHeight, 0,
    ]);
    const geom = new BufferGeometry();
    geom.setAttribute('position', new BufferAttribute(positions, 3));
    geom.setIndex([0, 1, 2]);
    geom.computeVertexNormals();
    return geom;
  }, [width, wallHeight, ridgeHeight]);

  const halfD = depth / 2;
  return (
    <group>
      {/* Front gable */}
      <mesh geometry={triangleGeom} position={[0, 0, halfD]}>
        <meshToonMaterial color={COLOR_GABLE} side={2} />
        <Edges threshold={EDGE_THRESHOLD} color={EDGE_COLOR} lineWidth={1.5} />
      </mesh>
      {/* Back gable */}
      <mesh geometry={triangleGeom} position={[0, 0, -halfD]}>
        <meshToonMaterial color={COLOR_GABLE} side={2} />
        <Edges threshold={EDGE_THRESHOLD} color={EDGE_COLOR} lineWidth={1.5} />
      </mesh>
    </group>
  );
}

// Fallback symmetric saddle roof when analysis.faces is empty
function DefaultRoof({
  width,
  depth,
  wallHeight,
}: {
  width: number;
  depth: number;
  wallHeight: number;
}) {
  const ridgeHeight = wallHeight + 1.6;
  const halfW = width / 2;
  const halfD = depth / 2;

  // Two quads sharing the ridge edge — built explicitly so we control winding
  // and so <Edges> tracks the right hard edges (eaves + ridge).
  const frontGeom = useMemo(() => {
    const g = new BufferGeometry();
    const positions = new Float32Array([
      -halfW, wallHeight, halfD,
      halfW, wallHeight, halfD,
      halfW, ridgeHeight, 0,
      -halfW, ridgeHeight, 0,
    ]);
    g.setAttribute('position', new BufferAttribute(positions, 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.computeVertexNormals();
    return g;
  }, [halfW, halfD, wallHeight, ridgeHeight]);

  const backGeom = useMemo(() => {
    const g = new BufferGeometry();
    const positions = new Float32Array([
      halfW, wallHeight, -halfD,
      -halfW, wallHeight, -halfD,
      -halfW, ridgeHeight, 0,
      halfW, ridgeHeight, 0,
    ]);
    g.setAttribute('position', new BufferAttribute(positions, 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.computeVertexNormals();
    return g;
  }, [halfW, halfD, wallHeight, ridgeHeight]);

  return (
    <group>
      <mesh geometry={frontGeom} castShadow receiveShadow>
        <meshToonMaterial color={COLOR_ROOF} side={2} />
        <Edges threshold={EDGE_THRESHOLD} color={EDGE_COLOR} lineWidth={1.5} />
      </mesh>
      <mesh geometry={backGeom} castShadow receiveShadow>
        <meshToonMaterial color={COLOR_ROOF} side={2} />
        <Edges threshold={EDGE_THRESHOLD} color={EDGE_COLOR} lineWidth={1.5} />
      </mesh>
    </group>
  );
}
