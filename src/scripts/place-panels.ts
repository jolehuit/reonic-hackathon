// Panel placement algorithm — OWNED by Dev D
// Given a roof face + obstructions + module size, return panel positions on a grid.

import * as THREE from 'three';
import type { RoofFace, Obstruction } from '@/lib/types';

const MODULE_WIDTH_M = 1.7;
const MODULE_HEIGHT_M = 1.0;
const EDGE_OFFSET_M = 0.5;
const MODULE_GAP_M = 0.05;

interface ModulePosition {
  x: number;
  y: number;
  z: number;
  faceId: number;
}

/**
 * Place modules on a single roof face on a regular grid.
 * Steps:
 *   1. Build a local frame on the face (normal = z, plus tangent + bitangent).
 *   2. Project the polygon vertices to 2D in that frame.
 *   3. Shrink the polygon by `EDGE_OFFSET_M` (per-edge inset).
 *   4. Tile a (W+gap) × (H+gap) grid across the polygon AABB.
 *   5. Keep cells whose center is inside the inset polygon AND outside every obstruction.
 *   6. Project each kept center back to world coords.
 */
export function placePanelsOnFace(
  face: RoofFace,
  obstructions: Obstruction[],
  maxModules?: number,
): ModulePosition[] {
  if (!face.vertices || face.vertices.length < 3) return [];

  const normal = new THREE.Vector3().fromArray(face.normal).normalize();
  const origin = new THREE.Vector3().fromArray(face.vertices[0] as [number, number, number]);

  // Pick a stable tangent: take an edge of the polygon, project it onto the face plane.
  const edgeWorld = new THREE.Vector3()
    .fromArray(face.vertices[1] as [number, number, number])
    .sub(origin);
  const tangent = edgeWorld.clone().sub(normal.clone().multiplyScalar(edgeWorld.dot(normal))).normalize();
  const bitangent = new THREE.Vector3().crossVectors(normal, tangent).normalize();

  // World → local 2D
  const toLocal = (p: number[]): { u: number; v: number } => {
    const w = new THREE.Vector3().fromArray(p as [number, number, number]).sub(origin);
    return { u: w.dot(tangent), v: w.dot(bitangent) };
  };
  const toWorld = (u: number, v: number): THREE.Vector3 =>
    origin
      .clone()
      .add(tangent.clone().multiplyScalar(u))
      .add(bitangent.clone().multiplyScalar(v));

  const polygon2D = face.vertices.map(toLocal);

  // Polygon AABB in local frame.
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const { u, v } of polygon2D) {
    if (u < minU) minU = u;
    if (u > maxU) maxU = u;
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  }

  const stepU = MODULE_WIDTH_M + MODULE_GAP_M;
  const stepV = MODULE_HEIGHT_M + MODULE_GAP_M;
  const startU = minU + EDGE_OFFSET_M + MODULE_WIDTH_M / 2;
  const startV = minV + EDGE_OFFSET_M + MODULE_HEIGHT_M / 2;
  const endU = maxU - EDGE_OFFSET_M - MODULE_WIDTH_M / 2;
  const endV = maxV - EDGE_OFFSET_M - MODULE_HEIGHT_M / 2;

  // Pre-project obstructions to local 2D (sphere projected onto face plane → disc).
  const obstructions2D = obstructions.map((o) => {
    const w = new THREE.Vector3().fromArray(o.position).sub(origin);
    return { u: w.dot(tangent), v: w.dot(bitangent), r: o.radius + 0.2 };
  });

  const candidates: { u: number; v: number; yieldScore: number }[] = [];
  for (let u = startU; u <= endU + 1e-6; u += stepU) {
    for (let v = startV; v <= endV + 1e-6; v += stepV) {
      if (!isInsetInside(polygon2D, u, v, EDGE_OFFSET_M)) continue;
      if (obstructions2D.some((o) => Math.hypot(o.u - u, o.v - v) < o.r)) continue;
      // Higher v == closer to ridge → slightly higher yield (cheap heuristic).
      const yieldScore = v;
      candidates.push({ u, v, yieldScore });
    }
  }

  candidates.sort((a, b) => b.yieldScore - a.yieldScore);
  const kept = typeof maxModules === 'number' ? candidates.slice(0, maxModules) : candidates;

  return kept.map(({ u, v }) => {
    const w = toWorld(u, v);
    return { x: w.x, y: w.y, z: w.z, faceId: face.id };
  });
}

/**
 * Point-in-polygon (ray casting) with a uniform inset.
 * The inset is approximate: we test the point AND the four corners of the
 * module footprint against the original polygon. Good enough for hackathon.
 */
function isInsetInside(
  polygon: { u: number; v: number }[],
  u: number,
  v: number,
  inset: number,
): boolean {
  const halfW = MODULE_WIDTH_M / 2 + inset;
  const halfH = MODULE_HEIGHT_M / 2 + inset;
  const corners = [
    { u, v },
    { u: u - halfW, v: v - halfH },
    { u: u + halfW, v: v - halfH },
    { u: u - halfW, v: v + halfH },
    { u: u + halfW, v: v + halfH },
  ];
  return corners.every((c) => pointInPolygon(polygon, c.u, c.v));
}

function pointInPolygon(polygon: { u: number; v: number }[], u: number, v: number): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const pi = polygon[i];
    const pj = polygon[j];
    const intersect =
      pi.v > v !== pj.v > v &&
      u < ((pj.u - pi.u) * (v - pi.v)) / (pj.v - pi.v) + pi.u;
    if (intersect) inside = !inside;
  }
  return inside;
}
