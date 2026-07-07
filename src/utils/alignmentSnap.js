/**
 * Compute alignment snapping for a node being dragged.
 *
 * For each other node, checks edge-to-edge and center-to-center alignment
 * on both axes. When a pair is within `threshold` pixels, the drag node's
 * position is snapped and a guide line coordinate is returned.
 *
 * @param {{ id: string, position: {x:number,y:number}, width: number, height: number }} dragNode
 * @param {Array<{ id: string, position: {x:number,y:number}, width: number, height: number }>} otherNodes
 * @param {number} threshold
 * @returns {{ snappedPosition: {x:number,y:number}|null, guides: Array<{axis:'x'|'y', value:number}> }}
 */
export function computeAlignmentSnap(dragNode, otherNodes, threshold) {
  if (!otherNodes.length) return { snappedPosition: null, guides: [] };

  const { x, y } = dragNode.position;
  const w = dragNode.width;
  const h = dragNode.height;

  let snapX = null;
  let snapY = null;
  let distX = threshold;
  let distY = threshold;
  let guideX = null;
  let guideY = null;

  for (const other of otherNodes) {
    const ox = other.position.x;
    const oy = other.position.y;
    const ow = other.width;
    const oh = other.height;

    // --- X-axis (vertical guide lines) ---
    const xSnaps = [
      { val: ox,           guide: ox },
      { val: ox + ow - w,  guide: ox + ow },
      { val: ox + ow,      guide: ox + ow },
      { val: ox - w,       guide: ox },
      { val: ox + ow / 2 - w / 2, guide: ox + ow / 2 },
    ];
    for (const s of xSnaps) {
      const d = Math.abs(s.val - x);
      if (d < distX) {
        distX = d;
        snapX = s.val;
        guideX = s.guide;
      }
    }

    // --- Y-axis (horizontal guide lines) ---
    const ySnaps = [
      { val: oy,           guide: oy },
      { val: oy + oh - h,  guide: oy + oh },
      { val: oy + oh,      guide: oy + oh },
      { val: oy - h,       guide: oy },
      { val: oy + oh / 2 - h / 2, guide: oy + oh / 2 },
    ];
    for (const s of ySnaps) {
      const d = Math.abs(s.val - y);
      if (d < distY) {
        distY = d;
        snapY = s.val;
        guideY = s.guide;
      }
    }
  }

  const guides = [];
  if (guideX !== null) guides.push({ axis: 'x', value: guideX });
  if (guideY !== null) guides.push({ axis: 'y', value: guideY });

  return {
    snappedPosition:
      snapX !== null || snapY !== null
        ? { x: snapX !== null ? snapX : x, y: snapY !== null ? snapY : y }
        : null,
    guides,
  };
}
