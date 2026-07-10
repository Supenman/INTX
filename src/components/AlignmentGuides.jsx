import { useViewport } from '@xyflow/react';

export default function AlignmentGuides({ guides }) {
  const viewport = useViewport();

  if (!guides || guides.length === 0) return null;

  const flowLeft = -viewport.x / viewport.zoom;
  const flowTop = -viewport.y / viewport.zoom;

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
          // Vertical guide — snap to flow X, extends between Y bounds of the two nodes
          const x = g.value;
          const y1 = g.min;
          const y2 = g.max;
          const sx = (x - flowLeft) * viewport.zoom;
          const sy1 = (y1 - flowTop) * viewport.zoom;
          const sy2 = (y2 - flowTop) * viewport.zoom;
          return (
            <line
              key={i}
              x1={sx}
              y1={sy1}
              x2={sx}
              y2={sy2}
              strokeWidth={1.5}
              strokeDasharray="4 3"
              style={{ stroke: 'rgba(var(--text-primary-rgb), 0.5)' }}
            />
          );
        } else {
          // Horizontal guide — snap to flow Y, extends between X bounds of the two nodes
          const y = g.value;
          const x1 = g.min;
          const x2 = g.max;
          const sy = (y - flowTop) * viewport.zoom;
          const sx1 = (x1 - flowLeft) * viewport.zoom;
          const sx2 = (x2 - flowLeft) * viewport.zoom;
          return (
            <line
              key={i}
              x1={sx1}
              y1={sy}
              x2={sx2}
              y2={sy}
              strokeWidth={1.5}
              strokeDasharray="4 3"
              style={{ stroke: 'rgba(var(--text-primary-rgb), 0.5)' }}
            />
          );
        }
      })}
    </svg>
  );
}
