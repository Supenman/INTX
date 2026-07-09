const TEXT_MIN = 200;
const TEXT_TYPES = ['text', 'source-text', 'source-markdown'];

/**
 * Compute new dimensions for a node being resized.
 *
 * @param {string} type
 * @param {number} startWidth
 * @param {number} startHeight
 * @param {number} deltaX - mouse delta in screen pixels
 * @param {number} deltaY - mouse delta in screen pixels
 * @param {number} aspectRatio - width/height ratio (used for proportional types)
 * @param {number} zoom - current viewport zoom
 * @param {number} defaultWidth - default width for this node (used as min for non-text)
 * @param {number} defaultHeight - default height for this node (used as min for non-text)
 * @returns {{ width: number, height: number }}
 */
export function computeResizeDimensions(type, startWidth, startHeight, deltaX, deltaY, aspectRatio, zoom, defaultWidth = 150, defaultHeight = 150) {
  if (TEXT_TYPES.includes(type)) {
    const width = Math.max(TEXT_MIN, Math.round(startWidth + deltaX / zoom));
    const height = Math.max(TEXT_MIN, Math.round(startHeight + deltaY / zoom));
    return { width, height };
  }

  // Proportional resize: ensure neither dimension goes below the default size
  let newWidth = Math.max(defaultWidth, Math.round(startWidth + deltaX / zoom));
  let newHeight = Math.round(newWidth / aspectRatio);
  if (newHeight < defaultHeight) {
    newHeight = defaultHeight;
    newWidth = Math.round(newHeight * aspectRatio);
  }
  return { width: newWidth, height: newHeight };
}
