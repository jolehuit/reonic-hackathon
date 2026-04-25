// House model — OWNED by Dev A
// Procedural low-poly architectural mockup, driven by Dev D's analysis.json.
// The raw 3D Tiles photogrammetric mesh is NEVER rendered to the user.
//
// Pipeline:
//   3D Tiles (Google)  →  fetch-3d-tiles.ts (Dev D, offline)  →  photogrammetry.glb (cache, never served)
//                      →  analyze-roof.ts (Dev D, offline)    →  analysis.json (footprint + faces + obstructions + panels)
//   ↓
//   House.tsx (Dev A, runtime) reads analysis.json and builds a clean toon-shaded mesh on the fly.
//
// Style: white/cream toon volume + black outline (rendered by EffectComposer in Scene3D),
// hard edges, MeshToonMaterial. Think Norman Foster low-poly architectural rendering.

'use client';

import { useEffect, useState } from 'react';
import type { HouseId, RoofGeometry } from '@/lib/types';

interface Props {
  houseId: HouseId;
}

export function House({ houseId }: Props) {
  const [analysis, setAnalysis] = useState<RoofGeometry | null>(null);
  const [footprint, setFootprint] = useState<{ size: [number, number, number] } | null>(null);

  useEffect(() => {
    fetch(`/baked/${houseId}-analysis.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        setAnalysis(data);
        if (data.buildingFootprint?.size) {
          setFootprint({ size: data.buildingFootprint.size });
        }
      })
      .catch(() => {
        /* fall back to default proportions below */
      });
  }, [houseId]);

  // Default proportions if analysis.json hasn't been baked yet (Dev A unblocked from Sat 15:00)
  const size: [number, number, number] = footprint?.size ?? [7, 6, 5];
  const [w, , d] = size;
  const wallHeight = 3;

  return (
    <group>
      {/* Walls — flat box */}
      <mesh position={[0, wallHeight / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, wallHeight, d]} />
        <meshToonMaterial color="#f5f1ea" />
      </mesh>

      {/* Roof — driven by analysis.faces if present, else a default symmetric hip */}
      {analysis?.faces && analysis.faces.length > 0 ? (
        analysis.faces.map((face) => <RoofFace key={face.id} face={face} />)
      ) : (
        <DefaultRoof width={w} depth={d} wallHeight={wallHeight} />
      )}

      {/* Obstructions (chimneys, dormers) — extruded blocks */}
      {analysis?.obstructions?.map((obs) => (
        <mesh
          key={obs.id}
          position={[obs.position[0], obs.position[1], obs.position[2]]}
          castShadow
        >
          <boxGeometry args={[obs.radius * 1.6, 1.2, obs.radius * 1.6]} />
          <meshToonMaterial color="#8b5e3c" />
        </mesh>
      ))}

      {/* Ground plane */}
      <mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[60, 60]} />
        <meshToonMaterial color="#e8e8e8" />
      </mesh>
    </group>
  );
}

// Render one roof face from analysis.json (vertices in mesh-local coords)
function RoofFace({ face }: { face: RoofGeometry['faces'][number] }) {
  // TODO Dev A: build a triangulated geometry from face.vertices polygon.
  // For 4-vertex quads (most common), 2 triangles (0,1,2) + (0,2,3) is enough.
  // Use BufferGeometry + setIndex for a clean flat-shaded mesh.

  const v = face.vertices;
  if (v.length < 3) return null;

  return (
    <mesh castShadow>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[new Float32Array(v.flat()), 3]}
        />
        <bufferAttribute
          attach="index"
          args={[
            new Uint16Array(
              v.length === 4
                ? [0, 1, 2, 0, 2, 3]
                : v.length === 3
                  ? [0, 1, 2]
                  : Array.from({ length: v.length - 2 }, (_, i) => [0, i + 1, i + 2]).flat(),
            ),
            1,
          ]}
        />
      </bufferGeometry>
      <meshToonMaterial color="#c14a3a" side={2} />
    </mesh>
  );
}

// Fallback symmetric hip roof when analysis.faces is empty
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
  return (
    <group>
      <mesh position={[0, (wallHeight + ridgeHeight) / 2, depth / 4]} rotation={[0.6, 0, 0]} castShadow>
        <planeGeometry args={[width + 0.5, depth * 0.6]} />
        <meshToonMaterial color="#c14a3a" side={2} />
      </mesh>
      <mesh position={[0, (wallHeight + ridgeHeight) / 2, -depth / 4]} rotation={[-0.6, 0, 0]} castShadow>
        <planeGeometry args={[width + 0.5, depth * 0.6]} />
        <meshToonMaterial color="#c14a3a" side={2} />
      </mesh>
    </group>
  );
}
