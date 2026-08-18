// The territory field, published so the buildings standing on it can read
// it.
//
// The ground layer already computes, every frame, the two things anybody
// else would need to ask about a claim: its colour, and how deep inside
// it a given pixel is. The buildings used to answer the first question
// from their own per-vertex attribute and had no way to ask the second,
// so a claim's paint was flat — every block dyed identically, right up to
// the last one on the border. Rather than compute a second distance field
// for the buildings, the ground hands over the textures it already has.
//
// Both layers are MapLibre custom layers on ONE WebGL context, and
// MapLibre runs every prerender before any render, so by the time the
// buildings draw, these textures hold this frame's field. That ordering
// is the whole reason this works; it is not an accident to rely on
// casually, and it is why the ref is cleared whenever the ground layer
// stops being able to fill it.
//
// Screen-space, so a reader converts a fragment's position on the glass
// into a lookup — see the buildings' vertex shader, which projects each
// vertex's GROUND point rather than the vertex itself, so a roof reads
// the field under its own footprint instead of the ground behind it.

export interface TerritoryFieldRef {
  // Sharp field: rgb premultiplied owner colour, a = coverage.
  sharp: WebGLTexture;
  // The same, blurred wide: a = how deep inside claimed ground.
  depth: WebGLTexture;
  // The buffers cover this multiple of the viewport, centred — readers
  // have to shrink their screen uv by it.
  pad: number;
}

let current: TerritoryFieldRef | null = null;

export function publishTerritoryField(ref: TerritoryFieldRef | null) {
  current = ref;
}

export function getTerritoryField(): TerritoryFieldRef | null {
  return current;
}

// How hard to scale the drift between the wide and sharp colours into a
// 0..1 "this is my own ground, not a border" term. Lives here rather than
// in either layer: the ground and the buildings must read the field the
// same way, or a block's paint disagrees with the paint under it.
export const SEAM_FADE = 2.6;
