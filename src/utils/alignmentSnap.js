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
  // Perpendicular extent for the guide line — spans both nodes on the opposite axis
  let extentX = null; // { min, max } — Y bounds for a vertical guide
  let extentY = null; // { min, max } — X bounds for a horizontal guide

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
        // Vertical guide: extend from the top of the higher node to the bottom of the lower
        extentX = {
          min: Math.min(y, oy),
          max: Math.max(y + h, oy + oh),
        };
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
        // Horizontal guide: extend from the left of the leftmost node to the right of the rightmost
        extentY = {
          min: Math.min(x, ox),
          max: Math.max(x + w, ox + ow),
        };
      }
    }
  }

  const guides = [];
  if (guideX !== null && extentX) guides.push({ axis: 'x', value: guideX, ...extentX });
  if (guideY !== null && extentY) guides.push({ axis: 'y', value: guideY, ...extentY });

  return {
    snappedPosition:
      snapX !== null || snapY !== null
        ? { x: snapX !== null ? snapX : x, y: snapY !== null ? snapY : y }
        : null,
    guides,
  };
}
