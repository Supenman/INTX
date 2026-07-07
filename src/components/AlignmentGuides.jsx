import { useViewport } from '@xyflow/react';

const LINE_COLOR = 'rgba(0, 195, 255, 0.5)';
const LINE_STYLE = { stroke: LINE_COLOR, strokeWidth: 1, strokeDasharray: '4 2' };

export default function AlignmentGuides({ guides }) {
  const viewport = useViewport();

  if (!guides || guides.length === 0) return null;

  // Visible area in flow coordinates
  const width = window.innerWidth;
  const height = window.innerHeight;
  const flowLeft = -viewport.x / viewport.zoom;
  const flowTop = -viewport.y / viewport.zoom;
  const flowRight = flowLeft + width / viewport.zoom;
  const flowBottom = flowTop + height / viewport.zoom;

  return (
    <svg
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        zIndex: 100,
        pointerEvents: 'none',
      }}
    >
      {guides.map((g, i) => {
        if (g.axis === 'x') {
          // Vertical line — snap to a flow X coordinate
          const x = g.value;
          if (x < flowLeft || x > flowRight) return null;
          const sx = (x - flowLeft) * viewport.zoom;
          return (
            <line
              key={i}
              x1={sx}
              y1={0}
              x2={sx}
              y2={height}
              {...LINE_STYLE}
              style={{ filter: 'drop-shadow(0 0 3px rgba(0,195,255,0.3))' }}
            />
          );
        } else {
          // Horizontal line — snap to a flow Y coordinate
          const y = g.value;
          if (y < flowTop || y > flowBottom) return null;
          const sy = (y - flowTop) * viewport.zoom;
          return (
            <line
              key={i}
              x1={0}
              y1={sy}
              x2={width}
              y2={sy}
              {...LINE_STYLE}
              style={{ filter: 'drop-shadow(0 0 3px rgba(0,195,255,0.3))' }}
            />
          );
        }
      })}
    </svg>
  );
}
