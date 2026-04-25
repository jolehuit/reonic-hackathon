// Building renderer — OWNED by Dev A
// "Dumb" instancer: takes a BuildingDescription produced by Gemini Vision and
// matérialises it in Three.js. No procedural decisions are made here — every
// dimension, position and color is determined by the AI agent.

'use client';

import { useMemo } from 'react';
import { Edges } from '@react-three/drei';
import { BufferAttribute, BufferGeometry } from 'three';
import { useSceneVision } from './vision/useSceneVision';
import type {
  Facade,
  FacadeOrientation,
  Opening,
  Roof,
  RoofFeature,
  Volume,
} from './vision/buildingTypes';

const EDGE_COLOR = '#111111';
const EDGE_THRESHOLD = 15;
const EDGE_LINE_WIDTH = 1.5;

const FACADE_TRANSFORMS: Record<
  FacadeOrientation,
  { rotY: number; offsetAxis: 'x' | 'z'; sign: 1 | -1 }
> = {
  south: { rotY: 0, offsetAxis: 'z', sign: 1 },
  north: { rotY: Math.PI, offsetAxis: 'z', sign: -1 },
  east: { rotY: -Math.PI / 2, offsetAxis: 'x', sign: 1 },
  west: { rotY: Math.PI / 2, offsetAxis: 'x', sign: -1 },
};

export function BuildingRenderer() {
  const { building } = useSceneVision();
  if (!building) return null;
  return (
    <group>
      <Ground />
      {building.volumes.map((v, i) => (
        <VolumeMesh key={i} volume={v} trimColor={building.trimColor} />
      ))}
    </group>
  );
}

function Ground() {
  return (
    <mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[80, 80]} />
      <meshToonMaterial color="#fafafa" />
    </mesh>
  );
}

function VolumeMesh({ volume, trimColor }: { volume: Volume; trimColor: string }) {
  const totalHeight = volume.storeyCount * volume.storeyHeightM;
  return (
    <group position={[volume.centerX, 0, volume.centerZ]}>
      {/* Walls */}
      <mesh position={[0, totalHeight / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[volume.width, totalHeight, volume.depth]} />
        <meshToonMaterial color={volume.wallColor} />
        <Edges threshold={EDGE_THRESHOLD} color={EDGE_COLOR} lineWidth={EDGE_LINE_WIDTH} />
      </mesh>

      {/* Storey divider bands */}
      {Array.from({ length: volume.storeyCount - 1 }, (_, i) => (
        <Band
          key={i}
          y={(i + 1) * volume.storeyHeightM}
          width={volume.width}
          depth={volume.depth}
          color={trimColor}
        />
      ))}

      {/* Facades — windows/doors */}
      {volume.facades.map((facade) => (
        <FacadeDecor
          key={facade.orientation}
          facade={facade}
          volumeWidth={volume.width}
          volumeDepth={volume.depth}
          storeyHeight={volume.storeyHeightM}
          trimColor={trimColor}
        />
      ))}

      {/* Roof + features */}
      <RoofMesh
        roof={volume.roof}
        wallTopY={totalHeight}
        width={volume.width}
        depth={volume.depth}
        wallColor={volume.wallColor}
      />
    </group>
  );
}

function Band({ y, width, depth, color }: { y: number; width: number; depth: number; color: string }) {
  return (
    <mesh position={[0, y, 0]}>
      <boxGeometry args={[width + 0.06, 0.1, depth + 0.06]} />
      <meshToonMaterial color={color} />
      <Edges threshold={EDGE_THRESHOLD} color={EDGE_COLOR} lineWidth={1} />
    </mesh>
  );
}

function FacadeDecor({
  facade,
  volumeWidth,
  volumeDepth,
  storeyHeight,
  trimColor,
}: {
  facade: Facade;
  volumeWidth: number;
  volumeDepth: number;
  storeyHeight: number;
  trimColor: string;
}) {
  const t = FACADE_TRANSFORMS[facade.orientation];
  const facadeWidth = t.offsetAxis === 'x' ? volumeDepth : volumeWidth;
  const offsetDistance = t.offsetAxis === 'x' ? volumeWidth / 2 : volumeDepth / 2;

  const position: [number, number, number] = [
    t.offsetAxis === 'x' ? t.sign * (offsetDistance + 0.005) : 0,
    0,
    t.offsetAxis === 'z' ? t.sign * (offsetDistance + 0.005) : 0,
  ];

  return (
    <group position={position} rotation={[0, t.rotY, 0]}>
      {facade.openings.map((op, i) => (
        <OpeningMesh
          key={i}
          opening={op}
          facadeWidth={facadeWidth}
          storeyHeight={storeyHeight}
          trimColor={trimColor}
        />
      ))}
    </group>
  );
}

function OpeningMesh({
  opening,
  facadeWidth,
  storeyHeight,
  trimColor,
}: {
  opening: Opening;
  facadeWidth: number;
  storeyHeight: number;
  trimColor: string;
}) {
  const x = (opening.horizontalPosition - 0.5) * facadeWidth;
  const baseY = opening.storey * storeyHeight;
  const isDoor = opening.type === 'door' || opening.type === 'garage_door';
  const sillOffset = isDoor ? 0 : 0.9;
  const y = baseY + sillOffset + opening.height / 2;

  const frameThickness = 0.05;

  return (
    <group position={[x, y, 0]}>
      <mesh position={[0, 0, 0.025]}>
        <boxGeometry args={[opening.width + 0.08, opening.height + 0.08, 0.05]} />
        <meshToonMaterial color={trimColor} />
        <Edges threshold={EDGE_THRESHOLD} color={EDGE_COLOR} lineWidth={1} />
      </mesh>
      <mesh position={[0, 0, 0.06]}>
        <planeGeometry args={[opening.width - frameThickness, opening.height - frameThickness]} />
        <meshToonMaterial color={isDoor ? '#3a3a3a' : '#5b7894'} />
      </mesh>
      {opening.hasShutters && !isDoor && (
        <>
          <mesh position={[-(opening.width / 2 + 0.12), 0, 0.04]}>
            <boxGeometry args={[opening.width * 0.18, opening.height + 0.05, 0.03]} />
            <meshToonMaterial color={trimColor} />
            <Edges threshold={EDGE_THRESHOLD} color={EDGE_COLOR} lineWidth={1} />
          </mesh>
          <mesh position={[opening.width / 2 + 0.12, 0, 0.04]}>
            <boxGeometry args={[opening.width * 0.18, opening.height + 0.05, 0.03]} />
            <meshToonMaterial color={trimColor} />
            <Edges threshold={EDGE_THRESHOLD} color={EDGE_COLOR} lineWidth={1} />
          </mesh>
        </>
      )}
      {isDoor && (
        <mesh position={[opening.width * 0.32, -opening.height * 0.05, 0.07]}>
          <sphereGeometry args={[0.04, 8, 8]} />
          <meshStandardMaterial color="#222" metalness={0.7} roughness={0.3} />
        </mesh>
      )}
    </group>
  );
}

function RoofMesh({
  roof,
  wallTopY,
  width,
  depth,
  wallColor,
}: {
  roof: Roof;
  wallTopY: number;
  width: number;
  depth: number;
  wallColor: string;
}) {
  if (roof.type === 'flat') {
    return (
      <>
        <mesh position={[0, wallTopY + 0.05, 0]} castShadow>
          <boxGeometry args={[width + roof.overhangM * 2, 0.1, depth + roof.overhangM * 2]} />
          <meshToonMaterial color={roof.color} />
          <Edges threshold={EDGE_THRESHOLD} color={EDGE_COLOR} lineWidth={EDGE_LINE_WIDTH} />
        </mesh>
        {roof.features.map((f, i) => (
          <RoofFeatureMesh key={i} feature={f} baseY={wallTopY + 0.1} />
        ))}
      </>
    );
  }

  // Pitched roof — rise from eave to ridge
  const halfBaseEave =
    roof.ridgeAxis === 'x' ? depth / 2 + roof.overhangM : width / 2 + roof.overhangM;
  const ridgeRise = halfBaseEave * Math.tan((roof.pitchDeg * Math.PI) / 180);
  const ridgeY = wallTopY + ridgeRise;
  const longExtent =
    roof.ridgeAxis === 'x' ? width / 2 + roof.overhangM : depth / 2 + roof.overhangM;

  return (
    <group>
      <RoofPan
        ridgeAxis={roof.ridgeAxis}
        side="positive"
        wallTopY={wallTopY}
        ridgeY={ridgeY}
        halfBase={halfBaseEave}
        longBase={longExtent}
        color={roof.color}
      />
      <RoofPan
        ridgeAxis={roof.ridgeAxis}
        side="negative"
        wallTopY={wallTopY}
        ridgeY={ridgeY}
        halfBase={halfBaseEave}
        longBase={longExtent}
        color={roof.color}
      />
      {roof.type !== 'hip' && roof.type !== 'shed' && (
        <>
          <Gable
            ridgeAxis={roof.ridgeAxis}
            side="positive"
            wallTopY={wallTopY}
            ridgeY={ridgeY}
            width={width}
            depth={depth}
            color={wallColor}
          />
          <Gable
            ridgeAxis={roof.ridgeAxis}
            side="negative"
            wallTopY={wallTopY}
            ridgeY={ridgeY}
            width={width}
            depth={depth}
            color={wallColor}
          />
        </>
      )}
      {roof.features.map((f, i) => (
        <RoofFeatureMesh key={i} feature={f} baseY={wallTopY} />
      ))}
    </group>
  );
}

function RoofPan({
  ridgeAxis,
  side,
  wallTopY,
  ridgeY,
  halfBase,
  longBase,
  color,
}: {
  ridgeAxis: 'x' | 'z';
  side: 'positive' | 'negative';
  wallTopY: number;
  ridgeY: number;
  halfBase: number;
  longBase: number;
  color: string;
}) {
  const sign = side === 'positive' ? 1 : -1;
  const geom = useMemo(() => {
    let positions: number[];
    if (ridgeAxis === 'x') {
      // Ridge along X (z=0). Pan goes from eave at z=±halfBase up to ridge at z=0.
      const eaveZ = sign * halfBase;
      // Order: bottom-left, bottom-right, top-right, top-left (CCW from outside)
      positions =
        sign > 0
          ? [
              -longBase, wallTopY, eaveZ,
              longBase, wallTopY, eaveZ,
              longBase, ridgeY, 0,
              -longBase, ridgeY, 0,
            ]
          : [
              longBase, wallTopY, eaveZ,
              -longBase, wallTopY, eaveZ,
              -longBase, ridgeY, 0,
              longBase, ridgeY, 0,
            ];
    } else {
      // Ridge along Z (x=0). Pan goes from eave at x=±halfBase up to ridge at x=0.
      const eaveX = sign * halfBase;
      positions =
        sign > 0
          ? [
              eaveX, wallTopY, longBase,
              eaveX, wallTopY, -longBase,
              0, ridgeY, -longBase,
              0, ridgeY, longBase,
            ]
          : [
              eaveX, wallTopY, -longBase,
              eaveX, wallTopY, longBase,
              0, ridgeY, longBase,
              0, ridgeY, -longBase,
            ];
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.computeVertexNormals();
    return g;
  }, [ridgeAxis, sign, wallTopY, ridgeY, halfBase, longBase]);

  return (
    <mesh geometry={geom} castShadow receiveShadow>
      <meshToonMaterial color={color} side={2} />
      <Edges threshold={EDGE_THRESHOLD} color={EDGE_COLOR} lineWidth={EDGE_LINE_WIDTH} />
    </mesh>
  );
}

function Gable({
  ridgeAxis,
  side,
  wallTopY,
  ridgeY,
  width,
  depth,
  color,
}: {
  ridgeAxis: 'x' | 'z';
  side: 'positive' | 'negative';
  wallTopY: number;
  ridgeY: number;
  width: number;
  depth: number;
  color: string;
}) {
  const sign = side === 'positive' ? 1 : -1;
  const geom = useMemo(() => {
    let positions: number[];
    if (ridgeAxis === 'x') {
      // Gable on +X / -X wall (perpendicular to ridge along X).
      // Triangle in YZ plane at x=±width/2.
      const wallX = sign * (width / 2);
      const halfDepth = depth / 2;
      positions = [
        wallX, wallTopY, -halfDepth,
        wallX, wallTopY, halfDepth,
        wallX, ridgeY, 0,
      ];
    } else {
      // Gable on +Z / -Z wall (perpendicular to ridge along Z).
      // Triangle in XY plane at z=±depth/2.
      const wallZ = sign * (depth / 2);
      const halfWidth = width / 2;
      positions = [
        -halfWidth, wallTopY, wallZ,
        halfWidth, wallTopY, wallZ,
        0, ridgeY, wallZ,
      ];
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    g.setIndex([0, 1, 2]);
    g.computeVertexNormals();
    return g;
  }, [ridgeAxis, sign, wallTopY, ridgeY, width, depth]);

  return (
    <mesh geometry={geom}>
      <meshToonMaterial color={color} side={2} />
      <Edges threshold={EDGE_THRESHOLD} color={EDGE_COLOR} lineWidth={EDGE_LINE_WIDTH} />
    </mesh>
  );
}

function RoofFeatureMesh({ feature, baseY }: { feature: RoofFeature; baseY: number }) {
  const x = feature.positionX;
  const z = feature.positionZ;
  const color = feature.type === 'chimney' ? '#7a5440' : feature.type === 'dormer' ? '#ece4d4' : '#cccccc';
  return (
    <mesh position={[x, baseY + feature.heightAboveRoof / 2, z]} castShadow>
      <boxGeometry args={[feature.width, feature.heightAboveRoof, feature.depth]} />
      <meshToonMaterial color={color} />
      <Edges threshold={EDGE_THRESHOLD} color={EDGE_COLOR} lineWidth={1.2} />
    </mesh>
  );
}
