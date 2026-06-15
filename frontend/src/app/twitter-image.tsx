import { ImageResponse } from 'next/og';

export const runtime = 'edge';

export const alt = 'Gideon — Map Your Thoughts';
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = 'image/png';

export default async function Image() {
  const nodes = [
    { x: 120, y: 90, r: 6 },
    { x: 280, y: 140, r: 5 },
    { x: 80, y: 260, r: 4 },
    { x: 200, y: 320, r: 5 },
    { x: 340, y: 280, r: 4 },
    { x: 160, y: 450, r: 5 },
    { x: 300, y: 500, r: 4 },
    { x: 60, y: 520, r: 3 },
    { x: 900, y: 100, r: 5 },
    { x: 1050, y: 180, r: 6 },
    { x: 1140, y: 90, r: 4 },
    { x: 980, y: 300, r: 5 },
    { x: 1100, y: 380, r: 4 },
    { x: 870, y: 450, r: 5 },
    { x: 1020, y: 520, r: 4 },
    { x: 1150, y: 540, r: 3 },
  ];

  const edges = [
    [0, 1], [0, 2], [1, 4], [2, 3], [3, 4],
    [3, 5], [5, 6], [5, 7], [2, 7],
    [8, 9], [9, 10], [9, 11], [11, 12], [10, 12],
    [11, 13], [13, 14], [12, 15], [14, 15],
  ];

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #1c1b19 0%, #161514 50%, #0f0e0c 100%)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            width: '600px',
            height: '400px',
            transform: 'translate(-50%, -50%)',
            background: 'radial-gradient(ellipse, rgba(212, 166, 74, 0.08) 0%, transparent 70%)',
            display: 'flex',
          }}
        />

        <svg
          width="1200"
          height="630"
          viewBox="0 0 1200 630"
          style={{ position: 'absolute', top: 0, left: 0 }}
        >
          {edges.map(([a, b], i) => (
            <line
              key={`e${i}`}
              x1={nodes[a].x}
              y1={nodes[a].y}
              x2={nodes[b].x}
              y2={nodes[b].y}
              stroke="#d4a64a"
              strokeWidth="1.5"
              opacity="0.12"
            />
          ))}
          {nodes.map((n, i) => (
            <circle
              key={`n${i}`}
              cx={n.x}
              cy={n.y}
              r={n.r}
              fill="#d4a64a"
              opacity="0.2"
            />
          ))}
        </svg>

        <div
          style={{
            position: 'absolute',
            top: 0,
            left: '50%',
            transform: 'translateX(-50%)',
            width: '300px',
            height: '3px',
            background: 'linear-gradient(90deg, transparent, #d4a64a, transparent)',
            display: 'flex',
          }}
        />

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '80px',
            height: '80px',
            borderRadius: '20px',
            background: 'linear-gradient(135deg, #d4a64a, #b8923d)',
            marginBottom: '28px',
            boxShadow: '0 8px 32px rgba(212, 166, 74, 0.3)',
          }}
        >
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#161514" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="5" r="2.5" />
            <circle cx="5" cy="19" r="2.5" />
            <circle cx="19" cy="19" r="2.5" />
            <line x1="12" y1="7.5" x2="5" y2="16.5" />
            <line x1="12" y1="7.5" x2="19" y2="16.5" />
            <line x1="5" y1="19" x2="19" y2="19" />
          </svg>
        </div>

        <div
          style={{
            fontSize: '72px',
            fontWeight: 700,
            color: '#f5f3ed',
            letterSpacing: '-2px',
            lineHeight: 1,
            display: 'flex',
          }}
        >
          Gideon
        </div>

        <div
          style={{
            width: '60px',
            height: '3px',
            background: 'linear-gradient(90deg, #d4a64a, #f0d060)',
            margin: '20px 0',
            borderRadius: '2px',
            display: 'flex',
          }}
        />

        <div
          style={{
            fontSize: '28px',
            fontWeight: 400,
            color: '#d4a64a',
            letterSpacing: '4px',
            textTransform: 'uppercase' as const,
            display: 'flex',
          }}
        >
          Map Your Thoughts
        </div>

        <div
          style={{
            fontSize: '18px',
            color: 'rgba(245, 243, 237, 0.45)',
            marginTop: '16px',
            letterSpacing: '0.5px',
            display: 'flex',
          }}
        >
          Quiz, debate, plan, and explore with AI
        </div>

        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: '50%',
            transform: 'translateX(-50%)',
            width: '300px',
            height: '3px',
            background: 'linear-gradient(90deg, transparent, #d4a64a, transparent)',
            display: 'flex',
          }}
        />
      </div>
    ),
    {
      ...size,
    }
  );
}
