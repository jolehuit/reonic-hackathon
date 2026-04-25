declare module 'density-clustering' {
  export class DBSCAN {
    run(points: number[][], eps: number, minPts: number, distanceFn?: (a: number[], b: number[]) => number): number[][];
    noise: number[];
  }
  export class KMEANS {
    run(points: number[][], k: number): number[][];
  }
  export class OPTICS {
    run(points: number[][], eps: number, minPts: number): number[][];
  }
}
