// Vision-driven procedural house — OWNED by Dev A
// Replaces the simpler House.tsx when VisionParams are available. Geometry
// is built from useHouseGeometry() (Dev D's analysis.json) and styled via
// useSceneVision() (Gemini Vision output).
//
// While the AI call is in flight or has failed, falls back to a sensible
// default set of params so the scene always renders something coherent.

'use client';

import { useMemo } from 'react';
import { Edges } from '@react-three/drei';
import { BufferAttribute, BufferGeometry } from 'three';
import { useHouseGeometry } from './HouseGeometry';
import { useSceneVision } from './vision/useSceneVision';
import type { RoofFace as RoofFaceT } from '@/lib/types';
import { DEFAULT_VISION_PARAMS, type VisionParams } from './vision/visionTypes';

const EDGE_COLOR = '#111111';
const EDGE_THRESHOLD = 15;
const EDGE_LINE_WIDTH = 1.5;

export function StylizedHouse() {
  const { width, depth, faces, obstructions } = useHouseGeometry();
  const { params: aiParams } = useSceneVision();
  const params = aiParams ?? DEFAULT_VISION_PARAMS;

  const storeyHeight = 2.7;
  const wallHeight = storeyHeight * params.storeyCount;
  const eaveOverhang = clamp(params.roofOverhang, 0, 1.0);

  return (
    <group>
      {/* Walls — main volume, full height = storeys × 2.7 m */}
      <mesh position={[0, wallHeight / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[width, wallHeight, depth]} />
        <meshToonMaterial color={params.wallColor} />
        <Edges threshold={EDGE_THRESHOLD} color={EDGE_COLOR} lineWidth={EDGE_LINE_WIDTH} />
      </mesh>

      {/* Storey divider band — subtle horizontal trim between floors */}
      {params.storeyCount >= 2 && (
        <Band y={storeyHeight} width={width} depth={depth} color={params.trimColor} />
      )}

      {/* Front facade decoration: windows grid + door */}
      <Facade
        side="front"
        width={width}
        depth={depth}
        wallHeight={wallHeight}
        storeyHeight={storeyHeight}
        params={params}
      />
      <Facade
        side="back"
        width={width}
        depth={depth}
        wallHeight={wallHeight}
        storeyHeight={storeyHeight}
        params={params}
      />
      <Facade
        side="left"
        width={width}
        depth={depth}
        wallHeight={wallHeight}
        storeyHeight={storeyHeight}
        params={params}
      />
      <Facade
        side="right"
        width={width}
        depth={depth}
        wallHeight={wallHeight}
        storeyHeight={storeyHeight}
        params={params}
      />

      {/* Gable triangles seal the volume between wall top and ridge */}
      <Gables
        width={width}
        depth={depth}
        wallHeight={wallHeight}
        faces={faces}
        params={params}
      />

      {/* Roof — driven by analysis.faces if present, else a default symmetric saddle */}
      {faces.length > 0 ? (
        faces.map((face) => (
          <RoofFace
            key={face.id}
            face={face}
            color={params.roofColor}
            wallHeight={wallHeight}
            originalRidgeY={maxY(face.vertices)}
          />
        ))
      ) : (
        <DefaultRoof
          width={width}
          depth={depth}
          wallHeight={wallHeight}
          color={params.roofColor}
          overhang={eaveOverhang}
        />
      )}

      {/* Optional chimney — taken from analysis.json if it exists, else AI flag */}
      {(obstructions.length > 0 ? obstructions : params.hasChimney ? [defaultChimney(width, depth, wallHeight)] : []).map(
        (obs) => (
          <mesh
            key={obs.id}
            position={[obs.position[0], obs.position[1], obs.position[2]]}
            castShadow
          >
            <boxGeometry args={[0.55, 1.4, 0.55]} />
            <meshToonMaterial color="#7a5440" />
            <Edges
              threshold={EDGE_THRESHOLD}
              color={EDGE_COLOR}
              lineWidth={EDGE_LINE_WIDTH * 0.8}
            />
          </mesh>
        ),
      )}

      {/* Optional balcony on the front, second storey */}
      {params.hasBalcony && params.storeyCount >= 2 && (
        <Balcony
          width={width}
          depth={depth}
          y={storeyHeight + 0.05}
          trimColor={params.trimColor}
        />
      )}

      {/* Optional dormer — small projecting roof window on the south slope */}
      {params.hasDormer && (
        <Dormer
          width={width}
          depth={depth}
          wallHeight={wallHeight}
          wallColor={params.wallColor}
          roofColor={params.roofColor}
          trimColor={params.trimColor}
        />
      )}

      {/* Optional garage — adjacent volume on one side */}
      {params.hasGarage && (
        <Garage
          parentWidth={width}
          parentDepth={depth}
          wallHeight={wallHeight}
          wallColor={params.wallColor}
          roofColor={params.roofColor}
        />
      )}

      {/* Ground plane */}
      <mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[60, 60]} />
        <meshToonMaterial color="#fafafa" />
      </mesh>
    </group>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────

function Band({
  y,
  width,
  depth,
  color,
}: {
  y: number;
  width: number;
  depth: number;
  color: string;
}) {
  return (
    <mesh position={[0, y, 0]}>
      <boxGeometry args={[width + 0.05, 0.12, depth + 0.05]} />
      <meshToonMaterial color={color} />
      <Edges threshold={EDGE_THRESHOLD} color={EDGE_COLOR} lineWidth={1} />
    </mesh>
  );
}

interface FacadeProps {
  side: 'front' | 'back' | 'left' | 'right';
  width: number;
  depth: number;
  wallHeight: number;
  storeyHeight: number;
  params: VisionParams;
}

function Facade({ side, width, depth, wallHeight, storeyHeight, params }: FacadeProps) {
  const facadeWidth = side === 'front' || side === 'back' ? width : depth;
  const isFront = side === 'front';

  // Compute facade transform (position + rotation around Y)
  const transform = useMemo(() => {
    switch (side) {
      case 'front':
        return { position: [0, 0, depth / 2 + 0.005] as [number, number, number], rotY: 0 };
      case 'back':
        return { position: [0, 0, -depth / 2 - 0.005] as [number, number, number], rotY: Math.PI };
      case 'left':
        return { position: [-width / 2 - 0.005, 0, 0] as [number, number, number], rotY: -Math.PI / 2 };
      case 'right':
        return { position: [width / 2 + 0.005, 0, 0] as [number, number, number], rotY: Math.PI / 2 };
    }
  }, [side, width, depth]);

  // Window grid: windowsPerFacade columns on the front; reduce on side facades
  const cols = isFront
    ? Math.max(2, Math.min(params.windowsPerFacade, Math.floor(facadeWidth / 1.4)))
    : Math.max(1, Math.floor(facadeWidth / 2));
  const rows = params.storeyCount;

  const windowSize: [number, number] = useMemo(() => {
    if (params.windowStyle === 'square') return [0.9, 0.9];
    if (params.windowStyle === 'arched') return [0.85, 1.4];
    return [0.95, 1.25];
  }, [params.windowStyle]);

  const windows = useMemo(() => {
    const items: { x: number; y: number }[] = [];
    const colPitch = facadeWidth / cols;
    for (let r = 0; r < rows; r++) {
      const y = r * storeyHeight + storeyHeight * 0.55;
      for (let c = 0; c < cols; c++) {
        const x = -facadeWidth / 2 + colPitch / 2 + c * colPitch;
        // Skip the window where the front door sits (ground floor only)
        if (isFront && r === 0) {
          const doorX = doorPositionToX(params.doorPosition, facadeWidth);
          if (Math.abs(x - doorX) < colPitch * 0.6) continue;
        }
        items.push({ x, y });
      }
    }
    return items;
  }, [cols, rows, storeyHeight, facadeWidth, isFront, params.doorPosition]);

  return (
    <group position={transform.position} rotation={[0, transform.rotY, 0]}>
      {/* Windows */}
      {windows.map((w, i) => (
        <Window
          key={i}
          x={w.x}
          y={w.y}
          size={windowSize}
          frameColor={params.trimColor}
        />
      ))}

      {/* Front door */}
      {isFront && (
        <Door
          x={doorPositionToX(params.doorPosition, facadeWidth)}
          color={params.trimColor}
        />
      )}
    </group>
  );
}

function Window({
  x,
  y,
  size,
  frameColor,
}: {
  x: number;
  y: number;
  size: [number, number];
  frameColor: string;
}) {
  const [w, h] = size;
  const FRAME_THICKNESS = 0.08;
  return (
    <group position={[x, y, 0]}>
      {/* Frame plate (slight protrusion) */}
      <mesh position={[0, 0, 0.025]}>
        <boxGeometry args={[w + 0.08, h + 0.08, 0.05]} />
        <meshToonMaterial color={frameColor} />
        <Edges threshold={EDGE_THRESHOLD} color={EDGE_COLOR} lineWidth={1} />
      </mesh>
      {/* Glass */}
      <mesh position={[0, 0, 0.06]}>
        <planeGeometry args={[w - FRAME_THICKNESS, h - FRAME_THICKNESS]} />
        <meshToonMaterial color="#5b7894" />
      </mesh>
    </group>
  );
}

function Door({ x, color }: { x: number; color: string }) {
  return (
    <group position={[x, 0.95, 0.03]}>
      <mesh>
        <boxGeometry args={[0.95, 1.9, 0.08]} />
        <meshToonMaterial color={color} />
        <Edges threshold={EDGE_THRESHOLD} color={EDGE_COLOR} lineWidth={1.2} />
      </mesh>
      {/* Door knob */}
      <mesh position={[0.32, 0, 0.05]}>
        <sphereGeometry args={[0.04, 8, 8]} />
        <meshStandardMaterial color="#222" metalness={0.7} roughness={0.3} />
      </mesh>
    </group>
  );
}

function Balcony({
  width,
  depth,
  y,
  trimColor,
}: {
  width: number;
  depth: number;
  y: number;
  trimColor: string;
}) {
  const SLAB_THICK = 0.12;
  const SLAB_DEPTH = 1.1;
  const RAIL_HEIGHT = 0.95;
  return (
    <group position={[0, y, depth / 2 + SLAB_DEPTH / 2]}>
      {/* Slab */}
      <mesh>
        <boxGeometry args={[width * 0.5, SLAB_THICK, SLAB_DEPTH]} />
        <meshToonMaterial color="#dbd2c2" />
        <Edges threshold={EDGE_THRESHOLD} color={EDGE_COLOR} lineWidth={1} />
      </mesh>
      {/* Front railing */}
      <mesh position={[0, RAIL_HEIGHT / 2, SLAB_DEPTH / 2]}>
        <boxGeometry args={[width * 0.5, RAIL_HEIGHT, 0.04]} />
        <meshToonMaterial color={trimColor} transparent opacity={0.6} />
        <Edges threshold={EDGE_THRESHOLD} color={EDGE_COLOR} lineWidth={1} />
      </mesh>
    </group>
  );
}

function Gables({
  width,
  depth,
  wallHeight,
  faces,
  params,
}: {
  width: number;
  depth: number;
  wallHeight: number;
  faces: RoofFaceT[];
  params: VisionParams;
}) {
  // Detect ridge orientation from the analysis. Compare bounding box extents
  // of the face vertices: the axis where vertices share the same value at
  // peak height is the ridge axis. Default to east-west when unknown.
  const { ridgeHeight, ridgeAxis } = useMemo(() => {
    if (faces.length === 0) {
      return { ridgeHeight: wallHeight + 1.6, ridgeAxis: 'x' as const };
    }
    let maxH = wallHeight;
    for (const face of faces) {
      for (const v of face.vertices) if (v[1] > maxH) maxH = v[1];
    }
    const originalWallTop = 3;
    const rescaledRidge =
      Math.abs(originalWallTop - maxH) > 0.1
        ? wallHeight + (maxH - originalWallTop)
        : maxH;

    // Pick the axis (x or z) where peak vertices share the same coordinate
    // → that's the ridge direction.
    const peakVerts = faces
      .flatMap((f) => f.vertices)
      .filter((v) => Math.abs(v[1] - maxH) < 0.05);
    let ridgeAxis: 'x' | 'z' = 'x';
    if (peakVerts.length >= 2) {
      const xs = new Set(peakVerts.map((v) => Math.round(v[0] * 10)));
      const zs = new Set(peakVerts.map((v) => Math.round(v[2] * 10)));
      // Ridge runs along the axis with multiple distinct values; gables are
      // perpendicular to the ridge.
      ridgeAxis = xs.size >= zs.size ? 'x' : 'z';
    }
    return { ridgeHeight: rescaledRidge, ridgeAxis };
  }, [faces, wallHeight]);

  // Triangle base length and gable mounting axis depend on ridge orientation.
  const baseLength = ridgeAxis === 'x' ? width : depth;
  const halfBase = baseLength / 2;
  const triangleGeom = useMemo(() => {
    const positions = new Float32Array([
      -halfBase, wallHeight, 0,
      halfBase, wallHeight, 0,
      0, ridgeHeight, 0,
    ]);
    const geom = new BufferGeometry();
    geom.setAttribute('position', new BufferAttribute(positions, 3));
    geom.setIndex([0, 1, 2]);
    geom.computeVertexNormals();
    return geom;
  }, [halfBase, wallHeight, ridgeHeight]);

  // Place gables on the walls perpendicular to the ridge.
  // ridge along X → gables on the +X / -X walls (rotated to face east/west)
  // ridge along Z → gables on the +Z / -Z walls (no rotation needed)
  if (ridgeAxis === 'x') {
    const halfW = width / 2;
    return (
      <group>
        <mesh geometry={triangleGeom} position={[halfW, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
          <meshToonMaterial color={params.wallColor} side={2} />
          <Edges threshold={EDGE_THRESHOLD} color={EDGE_COLOR} lineWidth={EDGE_LINE_WIDTH} />
        </mesh>
        <mesh geometry={triangleGeom} position={[-halfW, 0, 0]} rotation={[0, -Math.PI / 2, 0]}>
          <meshToonMaterial color={params.wallColor} side={2} />
          <Edges threshold={EDGE_THRESHOLD} color={EDGE_COLOR} lineWidth={EDGE_LINE_WIDTH} />
        </mesh>
      </group>
    );
  }

  const halfD = depth / 2;
  return (
    <group>
      <mesh geometry={triangleGeom} position={[0, 0, halfD]}>
        <meshToonMaterial color={params.wallColor} side={2} />
        <Edges threshold={EDGE_THRESHOLD} color={EDGE_COLOR} lineWidth={EDGE_LINE_WIDTH} />
      </mesh>
      <mesh geometry={triangleGeom} position={[0, 0, -halfD]}>
        <meshToonMaterial color={params.wallColor} side={2} />
        <Edges threshold={EDGE_THRESHOLD} color={EDGE_COLOR} lineWidth={EDGE_LINE_WIDTH} />
      </mesh>
    </group>
  );
}

function RoofFace({
  face,
  color,
  wallHeight,
  originalRidgeY,
}: {
  face: RoofFaceT;
  color: string;
  wallHeight: number;
  originalRidgeY: number;
}) {
  const geometry = useMemo(() => {
    const v = face.vertices;
    if (v.length < 3) return null;

    // Re-scale Y so the analysis.json coordinates (originally based on a 3 m
    // wall height) match the AI-driven storey count.
    const ORIGINAL_WALL_TOP = 3;
    const yScale = wallHeight / ORIGINAL_WALL_TOP;
    const ridgeBoost = (originalRidgeY - ORIGINAL_WALL_TOP) * yScale; // proportional rise

    const flat = v.flatMap((p) => {
      const yScaled = p[1] === ORIGINAL_WALL_TOP ? wallHeight : wallHeight + ridgeBoost * ((p[1] - ORIGINAL_WALL_TOP) / Math.max(0.001, originalRidgeY - ORIGINAL_WALL_TOP));
      return [p[0], yScaled, p[2]];
    });

    const indices =
      v.length === 4
        ? [0, 1, 2, 0, 2, 3]
        : v.length === 3
          ? [0, 1, 2]
          : Array.from({ length: v.length - 2 }, (_, i) => [0, i + 1, i + 2]).flat();

    const geom = new BufferGeometry();
    geom.setAttribute('position', new BufferAttribute(new Float32Array(flat), 3));
    geom.setIndex(indices);
    geom.computeVertexNormals();
    return geom;
  }, [face.vertices, wallHeight, originalRidgeY]);

  if (!geometry) return null;

  return (
    <mesh geometry={geometry} castShadow receiveShadow>
      <meshToonMaterial color={color} side={2} />
      <Edges threshold={EDGE_THRESHOLD} color={EDGE_COLOR} lineWidth={EDGE_LINE_WIDTH} />
    </mesh>
  );
}

function DefaultRoof({
  width,
  depth,
  wallHeight,
  color,
  overhang,
}: {
  width: number;
  depth: number;
  wallHeight: number;
  color: string;
  overhang: number;
}) {
  const ridgeHeight = wallHeight + 1.6;
  const halfW = width / 2 + overhang;
  const halfD = depth / 2 + overhang;

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
        <meshToonMaterial color={color} side={2} />
        <Edges threshold={EDGE_THRESHOLD} color={EDGE_COLOR} lineWidth={EDGE_LINE_WIDTH} />
      </mesh>
      <mesh geometry={backGeom} castShadow receiveShadow>
        <meshToonMaterial color={color} side={2} />
        <Edges threshold={EDGE_THRESHOLD} color={EDGE_COLOR} lineWidth={EDGE_LINE_WIDTH} />
      </mesh>
    </group>
  );
}

// Dormer — small projection from the south roof slope with its own gable.
// Sits on the +Z slope (south = sunny side) at the mid-pitch height.
function Dormer({
  width,
  depth,
  wallHeight,
  wallColor,
  roofColor,
  trimColor,
}: {
  width: number;
  depth: number;
  wallHeight: number;
  wallColor: string;
  roofColor: string;
  trimColor: string;
}) {
  const DORMER_W = Math.min(1.6, width * 0.25);
  const DORMER_H = 1.2;
  const DORMER_D = 1.0;
  // Place the dormer on the south slope, halfway between eaves (z = depth/2)
  // and ridge (z = 0). Original analysis ridge at y=4.2, eaves at y=3
  // (3 m wallHeight); rescale linearly.
  const eaveZ = depth / 2;
  const dormerZ = eaveZ * 0.45;
  const slopeRise = wallHeight === 3 ? 1.2 : ((wallHeight / 3) * 1.2);
  const dormerBaseY = wallHeight + slopeRise * (1 - dormerZ / eaveZ) - 0.2;

  const peakY = dormerBaseY + DORMER_H + 0.6;

  return (
    <group position={[0, 0, dormerZ + DORMER_D / 4]}>
      {/* Dormer side walls */}
      <mesh position={[0, dormerBaseY + DORMER_H / 2, 0]} castShadow>
        <boxGeometry args={[DORMER_W, DORMER_H, DORMER_D]} />
        <meshToonMaterial color={wallColor} />
        <Edges threshold={EDGE_THRESHOLD} color={EDGE_COLOR} lineWidth={1.2} />
      </mesh>

      {/* Dormer window (front) */}
      <mesh position={[0, dormerBaseY + DORMER_H / 2, DORMER_D / 2 + 0.005]}>
        <boxGeometry args={[DORMER_W * 0.65, DORMER_H * 0.7, 0.04]} />
        <meshToonMaterial color={trimColor} />
        <Edges threshold={EDGE_THRESHOLD} color={EDGE_COLOR} lineWidth={1} />
      </mesh>
      <mesh position={[0, dormerBaseY + DORMER_H / 2, DORMER_D / 2 + 0.03]}>
        <planeGeometry args={[DORMER_W * 0.55, DORMER_H * 0.6]} />
        <meshToonMaterial color="#5b7894" />
      </mesh>

      {/* Dormer gable peak (small triangle on the front) */}
      <mesh position={[0, dormerBaseY + DORMER_H, DORMER_D / 2]} rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[DORMER_W * 0.6, peakY - dormerBaseY - DORMER_H, 3]} />
        <meshToonMaterial color={roofColor} side={2} />
        <Edges threshold={EDGE_THRESHOLD} color={EDGE_COLOR} lineWidth={1.2} />
      </mesh>
    </group>
  );
}

// Adjacent garage volume — a single-storey extension on the right wall.
function Garage({
  parentWidth,
  parentDepth,
  wallHeight,
  wallColor,
  roofColor,
}: {
  parentWidth: number;
  parentDepth: number;
  wallHeight: number;
  wallColor: string;
  roofColor: string;
}) {
  const GARAGE_W = 3.5;
  const GARAGE_H = 2.6;
  const GARAGE_D = parentDepth * 0.7;
  const x = parentWidth / 2 + GARAGE_W / 2;

  return (
    <group position={[x, 0, 0]}>
      {/* Walls */}
      <mesh position={[0, GARAGE_H / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[GARAGE_W, GARAGE_H, GARAGE_D]} />
        <meshToonMaterial color={wallColor} />
        <Edges threshold={EDGE_THRESHOLD} color={EDGE_COLOR} lineWidth={EDGE_LINE_WIDTH} />
      </mesh>
      {/* Flat roof slab */}
      <mesh position={[0, GARAGE_H + 0.05, 0]} castShadow>
        <boxGeometry args={[GARAGE_W + 0.2, 0.1, GARAGE_D + 0.2]} />
        <meshToonMaterial color={roofColor} />
        <Edges threshold={EDGE_THRESHOLD} color={EDGE_COLOR} lineWidth={1} />
      </mesh>
      {/* Garage door */}
      <mesh position={[0, GARAGE_H * 0.5 - 0.1, GARAGE_D / 2 + 0.005]}>
        <boxGeometry args={[GARAGE_W * 0.7, GARAGE_H * 0.75, 0.04]} />
        <meshToonMaterial color="#444" />
        <Edges threshold={EDGE_THRESHOLD} color={EDGE_COLOR} lineWidth={1} />
      </mesh>
    </group>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function doorPositionToX(pos: VisionParams['doorPosition'], facadeWidth: number): number {
  if (pos === 'left') return -facadeWidth * 0.25;
  if (pos === 'right') return facadeWidth * 0.25;
  return 0;
}

function maxY(vertices: number[][]): number {
  let m = -Infinity;
  for (const v of vertices) if (v[1] > m) m = v[1];
  return m;
}

function clamp(x: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, x));
}

function defaultChimney(
  width: number,
  depth: number,
  wallHeight: number,
): { id: string; type: 'chimney'; position: [number, number, number]; radius: number } {
  return {
    id: 'default-chimney',
    type: 'chimney',
    position: [width * 0.3, wallHeight + 1.6, -depth * 0.15],
    radius: 0.3,
  };
}
