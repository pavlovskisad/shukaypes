// earcut 3.x ships no TypeScript types (@types/earcut covers only the v2
// CommonJS API). The whole surface we use is the default export.
declare module 'earcut' {
  /**
   * Triangulates a polygon given as a flat coordinate array.
   * @param data flat vertex coords, e.g. [x0,y0, x1,y1, ...]
   * @param holeIndices vertex index (not array offset) where each hole ring
   *   starts, e.g. one hole beginning at the 5th vertex -> [5]
   * @param dim coords per vertex (default 2)
   * @returns triangle vertex indices into `data`
   */
  export default function earcut(
    data: ArrayLike<number>,
    holeIndices?: number[],
    dim?: number,
  ): number[];
}
