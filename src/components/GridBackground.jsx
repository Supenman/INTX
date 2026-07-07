import { useRef, useEffect } from 'react';
import { useTheme } from '../ThemeContext';
import { useViewport } from '@xyflow/react';
import { GRID_SIZE } from '../utils/nodeSize';

const MAJOR_INTERVAL = 5;

function GridBackground() {
  const canvasRef = useRef(null);
  const viewport = useViewport();
  const { isDark } = useTheme();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, rect.width, rect.height);

    const { x: offsetX, y: offsetY, zoom } = viewport;

    // Adapt grid to zoom
    const gridSize = Math.max(8, Math.min(60, GRID_SIZE * zoom));
    const majorGridSize = gridSize * MAJOR_INTERVAL;

    // Read CSS variables for grid colors
    const style = getComputedStyle(document.documentElement);
    const minorColor = style.getPropertyValue('--grid-color').trim();
    const majorColor = style.getPropertyValue('--grid-major').trim();

    const startX = -offsetX % gridSize;
    const startY = -offsetY % gridSize;
    const majorStartX = -offsetX % majorGridSize;
    const majorStartY = -offsetY % majorGridSize;

    const dotR = Math.max(0.4, Math.min(1.4, 1 / Math.sqrt(Math.max(zoom, 0.2))));

    // Major grid dots (every 5th) — drawn first so minor dots overlay if coincident
    for (let x = majorStartX; x <= rect.width + majorGridSize; x += majorGridSize) {
      for (let y = majorStartY; y <= rect.height + majorGridSize; y += majorGridSize) {
        ctx.beginPath();
        ctx.arc(x, y, dotR * 1.5, 0, Math.PI * 2);
        ctx.fillStyle = majorColor;
        ctx.fill();
      }
    }

    // Minor grid dots
    for (let x = startX; x <= rect.width + gridSize; x += gridSize) {
      const isMajorCol = Math.abs((x - startX) % majorGridSize) < 1;
      for (let y = startY; y <= rect.height + gridSize; y += gridSize) {
        const isMajor = isMajorCol && Math.abs((y - startY) % majorGridSize) < 1;
        if (isMajor) continue; // already drawn above
        ctx.beginPath();
        ctx.arc(x, y, dotR, 0, Math.PI * 2);
        ctx.fillStyle = minorColor;
        ctx.fill();
      }
    }
  }, [viewport, isDark]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        zIndex: 0,
        pointerEvents: 'none',
      }}
    />
  );
}

export default GridBackground;
