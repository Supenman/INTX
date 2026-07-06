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

    const dotRadius = 1;
    const gridSize = GRID_SIZE * zoom;
    const majorGridSize = gridSize * MAJOR_GRID_INTERVAL;

    const startX = -offsetX % gridSize;
    const startY = -offsetY % gridSize;
    const majorStartX = -offsetX % majorGridSize;
    const majorStartY = -offsetY % majorGridSize;

    ctx.fillStyle = isDark ? 'rgba(255, 255, 255, 0.035)' : 'rgba(0, 0, 0, 0.035)';
    
    for (let x = startX; x <= rect.width + gridSize; x += gridSize) {
      for (let y = startY; y <= rect.height + gridSize; y += gridSize) {
        ctx.beginPath();
        ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.fillStyle = isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.06)';
    const majorDotRadius = 2;
    
    for (let x = majorStartX; x <= rect.width + majorGridSize; x += majorGridSize) {
      for (let y = majorStartY; y <= rect.height + majorGridSize; y += majorGridSize) {
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