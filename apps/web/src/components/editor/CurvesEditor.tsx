import React, { useRef, useEffect, useState, useCallback } from 'react';

interface Point {
  x: number;
  y: number;
}

type Channel = 'rgb' | 'red' | 'green' | 'blue';

interface CurvesEditorProps {
  imageData: ImageData;
  onApply: (result: ImageData) => void;
}

const GRID_SIZE = 256;
const CANVAS_SIZE = 256;
const POINT_RADIUS = 6;

const CHANNEL_COLORS: Record<Channel, string> = {
  rgb: '#ffffff',
  red: '#ff4444',
  green: '#44ff44',
  blue: '#4488ff',
};

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** Monotone cubic spline interpolation for smooth, non-overshooting curves */
function splineInterpolate(points: Point[]): Uint8Array {
  const lut = new Uint8Array(256);
  if (points.length < 2) {
    for (let i = 0; i < 256; i++) lut[i] = i;
    return lut;
  }

  const sorted = [...points].sort((a, b) => a.x - b.x);
  const n = sorted.length;

  // Use monotone cubic interpolation (Fritsch-Carlson)
  const dx: number[] = [];
  const dy: number[] = [];
  const m: number[] = [];

  for (let i = 0; i < n - 1; i++) {
    dx.push(sorted[i + 1].x - sorted[i].x);
    dy.push(sorted[i + 1].y - sorted[i].y);
    m.push(dy[i] / (dx[i] || 1));
  }

  const tangents: number[] = [m[0]];
  for (let i = 1; i < n - 1; i++) {
    if (m[i - 1] * m[i] <= 0) {
      tangents.push(0);
    } else {
      tangents.push((m[i - 1] + m[i]) / 2);
    }
  }
  tangents.push(m[n - 2]);

  // Ensure monotonicity
  for (let i = 0; i < n - 1; i++) {
    if (Math.abs(m[i]) < 1e-6) {
      tangents[i] = 0;
      tangents[i + 1] = 0;
    } else {
      const a = tangents[i] / m[i];
      const b = tangents[i + 1] / m[i];
      const s = a * a + b * b;
      if (s > 9) {
        const t = 3 / Math.sqrt(s);
        tangents[i] = t * a * m[i];
        tangents[i + 1] = t * b * m[i];
      }
    }
  }

  for (let x = 0; x < 256; x++) {
    const nx = x / 255;
    if (nx <= sorted[0].x / 255) {
      lut[x] = clamp(Math.round(sorted[0].y), 0, 255);
      continue;
    }
    if (nx >= sorted[n - 1].x / 255) {
      lut[x] = clamp(Math.round(sorted[n - 1].y), 0, 255);
      continue;
    }

    // Find segment
    let seg = 0;
    for (let i = 0; i < n - 1; i++) {
      if (x >= sorted[i].x && x <= sorted[i + 1].x) {
        seg = i;
        break;
      }
    }

    const x0 = sorted[seg].x;
    const x1 = sorted[seg + 1].x;
    const y0 = sorted[seg].y;
    const y1 = sorted[seg + 1].y;
    const h = x1 - x0 || 1;
    const t = (x - x0) / h;
    const t2 = t * t;
    const t3 = t2 * t;

    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;

    const val = h00 * y0 + h10 * h * tangents[seg] + h01 * y1 + h11 * h * tangents[seg + 1];
    lut[x] = clamp(Math.round(val), 0, 255);
  }

  return lut;
}

function generateHistogram(imageData: ImageData): { r: number[]; g: number[]; b: number[] } {
  const r = new Array(256).fill(0);
  const g = new Array(256).fill(0);
  const b = new Array(256).fill(0);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    r[data[i]]++;
    g[data[i + 1]]++;
    b[data[i + 2]]++;
  }
  return { r, g, b };
}

const CurvesEditor: React.FC<CurvesEditorProps> = ({ imageData, onApply }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [channel, setChannel] = useState<Channel>('rgb');
  const [points, setPoints] = useState<Record<Channel, Point[]>>({
    rgb: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
    red: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
    green: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
    blue: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
  });
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
  const [histogram, setHistogram] = useState<{ r: number[]; g: number[]; b: number[] } | null>(null);

  // Compute histogram once on mount
  useEffect(() => {
    setHistogram(generateHistogram(imageData));
  }, [imageData]);

  const drawCurve = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    // Background
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    // Draw histogram
    if (histogram) {
      const histData = channel === 'rgb'
        ? histogram.r.map((v, i) => v + histogram.g[i] + histogram.b[i])
        : channel === 'red' ? histogram.r
        : channel === 'green' ? histogram.g
        : histogram.b;
      const maxHist = Math.max(...histData, 1);

      ctx.fillStyle = channel === 'rgb' ? 'rgba(128,128,128,0.3)' :
        channel === 'red' ? 'rgba(255,68,68,0.2)' :
        channel === 'green' ? 'rgba(68,255,68,0.2)' :
        'rgba(68,136,255,0.2)';
      for (let i = 0; i < 256; i++) {
        const h = (histData[i] / maxHist) * CANVAS_SIZE;
        ctx.fillRect(i, CANVAS_SIZE - h, 1, h);
      }
    }

    // Grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const pos = (CANVAS_SIZE / 4) * i;
      ctx.beginPath();
      ctx.moveTo(pos, 0);
      ctx.lineTo(pos, CANVAS_SIZE);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, pos);
      ctx.lineTo(CANVAS_SIZE, pos);
      ctx.stroke();
    }

    // Diagonal reference line
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, CANVAS_SIZE);
    ctx.lineTo(CANVAS_SIZE, 0);
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw the curve using LUT
    const lut = splineInterpolate(points[channel]);
    ctx.strokeStyle = CHANNEL_COLORS[channel];
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = 0; x < 256; x++) {
      const y = CANVAS_SIZE - lut[x];
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Draw control points
    points[channel].forEach((p) => {
      ctx.beginPath();
      ctx.arc(p.x, CANVAS_SIZE - p.y, POINT_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = CHANNEL_COLORS[channel];
      ctx.fill();
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1;
      ctx.stroke();
    });
  }, [channel, points, histogram]);

  useEffect(() => {
    drawCurve();
  }, [drawCurve]);

  const getCanvasPos = (e: React.MouseEvent<HTMLCanvasElement>): Point => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const scaleX = CANVAS_SIZE / rect.width;
    const scaleY = CANVAS_SIZE / rect.height;
    return {
      x: clamp(Math.round((e.clientX - rect.left) * scaleX), 0, 255),
      y: clamp(Math.round((CANVAS_SIZE - (e.clientY - rect.top) * scaleY)), 0, 255),
    };
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const pos = getCanvasPos(e);
    const pts = points[channel];

    // Check if clicking near an existing point
    const nearIdx = pts.findIndex(
      (p) => Math.hypot(p.x - pos.x, p.y - pos.y) < POINT_RADIUS * 2
    );

    if (nearIdx >= 0) {
      // Don't allow dragging endpoints off the edge
      setDraggingIdx(nearIdx);
    } else {
      // Add new point
      const newPoints = [...pts, pos].sort((a, b) => a.x - b.x);
      const newIdx = newPoints.findIndex((p) => p.x === pos.x && p.y === pos.y);
      setPoints((prev) => ({ ...prev, [channel]: newPoints }));
      setDraggingIdx(newIdx);
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (draggingIdx === null) return;
    const pos = getCanvasPos(e);
    const pts = [...points[channel]];
    
    // Keep first and last points at x=0 and x=255
    if (draggingIdx === 0) {
      pts[0] = { x: 0, y: pos.y };
    } else if (draggingIdx === pts.length - 1) {
      pts[pts.length - 1] = { x: 255, y: pos.y };
    } else {
      // Constrain between neighbors
      const minX = pts[draggingIdx - 1].x + 1;
      const maxX = pts[draggingIdx + 1].x - 1;
      pts[draggingIdx] = { x: clamp(pos.x, minX, maxX), y: pos.y };
    }
    setPoints((prev) => ({ ...prev, [channel]: pts }));
  };

  const handleMouseUp = () => {
    setDraggingIdx(null);
  };

  const handleDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const pos = getCanvasPos(e);
    const pts = points[channel];
    const nearIdx = pts.findIndex(
      (p) => Math.hypot(p.x - pos.x, p.y - pos.y) < POINT_RADIUS * 2
    );
    // Remove point on double-click (except endpoints)
    if (nearIdx > 0 && nearIdx < pts.length - 1) {
      const newPoints = pts.filter((_, i) => i !== nearIdx);
      setPoints((prev) => ({ ...prev, [channel]: newPoints }));
    }
  };

  const handleReset = () => {
    setPoints((prev) => ({
      ...prev,
      [channel]: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
    }));
  };

  const handleResetAll = () => {
    setPoints({
      rgb: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
      red: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
      green: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
      blue: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
    });
  };

  const handleApply = () => {
    const rgbLut = splineInterpolate(points.rgb);
    const rLut = splineInterpolate(points.red);
    const gLut = splineInterpolate(points.green);
    const bLut = splineInterpolate(points.blue);

    const result = new ImageData(
      new Uint8ClampedArray(imageData.data),
      imageData.width,
      imageData.height
    );

    for (let i = 0; i < result.data.length; i += 4) {
      result.data[i] = rgbLut[rLut[result.data[i]]];
      result.data[i + 1] = rgbLut[gLut[result.data[i + 1]]];
      result.data[i + 2] = rgbLut[bLut[result.data[i + 2]]];
    }

    onApply(result);
  };

  const channels: { key: Channel; label: string }[] = [
    { key: 'rgb', label: 'RGB' },
    { key: 'red', label: 'R' },
    { key: 'green', label: 'G' },
    { key: 'blue', label: 'B' },
  ];

  return (
    <div className="flex flex-col items-center gap-3">
      {/* Channel selector */}
      <div className="flex gap-1">
        {channels.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setChannel(key)}
            className={`px-3 py-1 text-xs font-medium rounded transition ${
              channel === key
                ? key === 'rgb' ? 'bg-white text-black'
                : key === 'red' ? 'bg-red-600 text-white'
                : key === 'green' ? 'bg-green-600 text-white'
                : 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Curve canvas */}
      <canvas
        ref={canvasRef}
        width={GRID_SIZE}
        height={GRID_SIZE}
        className="border border-gray-600 rounded cursor-crosshair w-full max-w-[256px] aspect-square"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onDoubleClick={handleDoubleClick}
      />

      <p className="text-gray-400 text-xs text-center">
        Click to add points. Double-click to remove. Drag to adjust.
      </p>

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={handleReset}
          className="px-3 py-1.5 text-xs bg-gray-700 text-gray-300 rounded hover:bg-gray-600 transition"
        >
          Reset Channel
        </button>
        <button
          onClick={handleResetAll}
          className="px-3 py-1.5 text-xs bg-gray-700 text-gray-300 rounded hover:bg-gray-600 transition"
        >
          Reset All
        </button>
        <button
          onClick={handleApply}
          className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 transition"
        >
          Apply Curves
        </button>
      </div>
    </div>
  );
};

export default CurvesEditor;
