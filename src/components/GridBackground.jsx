import { useRef, useEffect } from 'react';
import { useTheme } from '../ThemeContext';
import { useViewport } from '@xyflow/react';

const GRID_SIZE = 40;
const MAJOR_GRID_INTERVAL = 5;

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

    // Adapt grid and dot size to zoom level
    const effectiveGridSize = Math.max(20, Math.min(60, GRID_SIZE * zoom));
    const effectiveMajorGridSize = effectiveGridSize * MAJOR_GRID_INTERVAL;
    const dotRadius = Math.max(0.6, Math.min(1.5, 1 / Math.sqrt(Math.max(zoom, 0.1))));
    const majorDotRadius = Math.max(1, Math.min(2.5, 2 / Math.sqrt(Math.max(zoom, 0.1))));
    const dotAlpha = Math.min(1, zoom * 0.5);

    const startX = -offsetX % effectiveGridSize;
    const startY = -offsetY % effectiveGridSize;
    const majorStartX = -offsetX % effectiveMajorGridSize;
    const majorStartY = -offsetY % effectiveMajorGridSize;

    ctx.fillStyle = isDark
      ? `rgba(255, 255, 255, ${0.035 * dotAlpha})`
      : `rgba(0, 0, 0, ${0.035 * dotAlpha})`;

    for (let x = startX; x <= rect.width + effectiveGridSize; x += effectiveGridSize) {
      for (let y = startY; y <= rect.height + effectiveGridSize; y += effectiveGridSize) {
        ctx.beginPath();
        ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.fillStyle = isDark
      ? `rgba(255, 255, 255, ${0.06 * dotAlpha})`
      : `rgba(0, 0, 0, ${0.06 * dotAlpha})`;

    for (let x = majorStartX; x <= rect.width + effectiveMajorGridSize; x += effectiveMajorGridSize) {
      for (let y = majorStartY; y <= rect.height + effectiveMajorGridSize; y += effectiveMajorGridSize) {
        ctx.beginPath();
        ctx.arc(x, y, majorDotRadius, 0, Math.PI * 2);
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