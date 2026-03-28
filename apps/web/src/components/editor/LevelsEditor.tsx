import React, { useRef, useEffect, useState, useCallback } from 'react';

interface LevelsEditorProps {
  imageData: ImageData;
  onApply: (result: ImageData) => void;
}

type Channel = 'rgb' | 'red' | 'green' | 'blue';

const HIST_WIDTH = 256;
const HIST_HEIGHT = 100;

const CHANNEL_COLORS: Record<Channel, string> = {
  rgb: 'rgba(200,200,200,0.6)',
  red: 'rgba(255,68,68,0.6)',
  green: 'rgba(68,255,68,0.6)',
  blue: 'rgba(68,136,255,0.6)',
};

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function computeHistograms(imageData: ImageData) {
  const r = new Array(256).fill(0);
  const g = new Array(256).fill(0);
  const b = new Array(256).fill(0);
  const lum = new Array(256).fill(0);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    r[data[i]]++;
    g[data[i + 1]]++;
    b[data[i + 2]]++;
    const l = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    lum[l]++;
  }
  return { r, g, b, lum };
}

/** Apply levels adjustment: remap input range [inBlack, inWhite] with gamma to output range [outBlack, outWhite] */
function buildLevelsLUT(
  inBlack: number,
  inWhite: number,
  gamma: number,
  outBlack: number,
  outWhite: number
): Uint8Array {
  const lut = new Uint8Array(256);
  const inRange = Math.max(inWhite - inBlack, 1);
  const outRange = outWhite - outBlack;

  for (let i = 0; i < 256; i++) {
    // Clamp to input range
    const normalized = clamp((i - inBlack) / inRange, 0, 1);
    // Apply gamma
    const gammaCorrected = Math.pow(normalized, 1 / gamma);
    // Map to output range
    lut[i] = clamp(Math.round(outBlack + gammaCorrected * outRange), 0, 255);
  }
  return lut;
}

const LevelsEditor: React.FC<LevelsEditorProps> = ({ imageData, onApply }) => {
  const histCanvasRef = useRef<HTMLCanvasElement>(null);
  const [channel, setChannel] = useState<Channel>('rgb');
  
  // Per-channel levels state
  const [levels, setLevels] = useState<Record<Channel, {
    inBlack: number;
    inWhite: number;
    gamma: number;
    outBlack: number;
    outWhite: number;
  }>>({
    rgb: { inBlack: 0, inWhite: 255, gamma: 1.0, outBlack: 0, outWhite: 255 },
    red: { inBlack: 0, inWhite: 255, gamma: 1.0, outBlack: 0, outWhite: 255 },
    green: { inBlack: 0, inWhite: 255, gamma: 1.0, outBlack: 0, outWhite: 255 },
    blue: { inBlack: 0, inWhite: 255, gamma: 1.0, outBlack: 0, outWhite: 255 },
  });

  const [histograms, setHistograms] = useState<ReturnType<typeof computeHistograms> | null>(null);

  useEffect(() => {
    setHistograms(computeHistograms(imageData));
  }, [imageData]);

  const drawHistogram = useCallback(() => {
    const canvas = histCanvasRef.current;
    if (!canvas || !histograms) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, HIST_WIDTH, HIST_HEIGHT);
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, HIST_WIDTH, HIST_HEIGHT);

    const histData = channel === 'rgb' ? histograms.lum
      : channel === 'red' ? histograms.r
      : channel === 'green' ? histograms.g
      : histograms.b;

    const max = Math.max(...histData, 1);

    ctx.fillStyle = CHANNEL_COLORS[channel];
    for (let i = 0; i < 256; i++) {
      const h = (histData[i] / max) * HIST_HEIGHT;
      ctx.fillRect(i, HIST_HEIGHT - h, 1, h);
    }

    // Draw input markers
    const lev = levels[channel];
    
    // Black point marker
    ctx.fillStyle = '#000';
    ctx.fillRect(lev.inBlack - 1, 0, 3, HIST_HEIGHT);
    // White point marker
    ctx.fillStyle = '#fff';
    ctx.fillRect(lev.inWhite - 1, 0, 3, HIST_HEIGHT);
    // Gamma marker (midtone)
    const midPos = lev.inBlack + (lev.inWhite - lev.inBlack) * (1 / (1 + lev.gamma));
    ctx.fillStyle = '#888';
    ctx.strokeStyle = '#888';
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(midPos, 0);
    ctx.lineTo(midPos, HIST_HEIGHT);
    ctx.stroke();
    ctx.setLineDash([]);
  }, [channel, levels, histograms]);

  useEffect(() => {
    drawHistogram();
  }, [drawHistogram]);

  const currentLevels = levels[channel];

  const updateLevel = (key: string, value: number) => {
    setLevels((prev) => ({
      ...prev,
      [channel]: { ...prev[channel], [key]: value },
    }));
  };

  const handleReset = () => {
    setLevels((prev) => ({
      ...prev,
      [channel]: { inBlack: 0, inWhite: 255, gamma: 1.0, outBlack: 0, outWhite: 255 },
    }));
  };

  const handleResetAll = () => {
    const defaults = { inBlack: 0, inWhite: 255, gamma: 1.0, outBlack: 0, outWhite: 255 };
    setLevels({ rgb: { ...defaults }, red: { ...defaults }, green: { ...defaults }, blue: { ...defaults } });
  };

  const handleAutoLevels = () => {
    if (!histograms) return;
    const histData = channel === 'rgb' ? histograms.lum
      : channel === 'red' ? histograms.r
      : channel === 'green' ? histograms.g
      : histograms.b;

    const totalPixels = imageData.width * imageData.height;
    const threshold = totalPixels * 0.005; // 0.5% clip

    let inBlack = 0;
    let sum = 0;
    for (let i = 0; i < 256; i++) {
      sum += histData[i];
      if (sum > threshold) { inBlack = i; break; }
    }

    let inWhite = 255;
    sum = 0;
    for (let i = 255; i >= 0; i--) {
      sum += histData[i];
      if (sum > threshold) { inWhite = i; break; }
    }

    updateLevel('inBlack', inBlack);
    updateLevel('inWhite', Math.max(inWhite, inBlack + 1));
  };

  const applyLevels = useCallback(() => {
    const rgbLut = buildLevelsLUT(levels.rgb.inBlack, levels.rgb.inWhite, levels.rgb.gamma, levels.rgb.outBlack, levels.rgb.outWhite);
    const rLut = buildLevelsLUT(levels.red.inBlack, levels.red.inWhite, levels.red.gamma, levels.red.outBlack, levels.red.outWhite);
    const gLut = buildLevelsLUT(levels.green.inBlack, levels.green.inWhite, levels.green.gamma, levels.green.outBlack, levels.green.outWhite);
    const bLut = buildLevelsLUT(levels.blue.inBlack, levels.blue.inWhite, levels.blue.gamma, levels.blue.outBlack, levels.blue.outWhite);

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
  }, [imageData, levels, onApply]);

  // Live preview: apply levels immediately when any slider value changes.
  useEffect(() => {
    applyLevels();
  }, [applyLevels]);

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

      {/* Histogram */}
      <canvas
        ref={histCanvasRef}
        width={HIST_WIDTH}
        height={HIST_HEIGHT}
        className="border border-gray-600 rounded w-full max-w-[256px]"
      />

      {/* Input Levels */}
      <div className="w-full max-w-[256px] space-y-2">
        <h4 className="text-xs text-gray-400 font-medium">Input Levels</h4>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500 w-12">Black</label>
          <input
            type="range"
            min={0}
            max={Math.max(currentLevels.inWhite - 2, 0)}
            value={currentLevels.inBlack}
            onChange={(e) => updateLevel('inBlack', parseInt(e.target.value))}
            className="flex-1 h-1 accent-white"
          />
          <span className="text-xs text-gray-400 w-8 text-right">{currentLevels.inBlack}</span>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500 w-12">Gamma</label>
          <input
            type="range"
            min={10}
            max={300}
            value={Math.round(currentLevels.gamma * 100)}
            onChange={(e) => updateLevel('gamma', parseInt(e.target.value) / 100)}
            className="flex-1 h-1 accent-gray-400"
          />
          <span className="text-xs text-gray-400 w-8 text-right">{currentLevels.gamma.toFixed(2)}</span>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500 w-12">White</label>
          <input
            type="range"
            min={Math.min(currentLevels.inBlack + 2, 255)}
            max={255}
            value={currentLevels.inWhite}
            onChange={(e) => updateLevel('inWhite', parseInt(e.target.value))}
            className="flex-1 h-1 accent-white"
          />
          <span className="text-xs text-gray-400 w-8 text-right">{currentLevels.inWhite}</span>
        </div>
      </div>

      {/* Output Levels */}
      <div className="w-full max-w-[256px] space-y-2">
        <h4 className="text-xs text-gray-400 font-medium">Output Levels</h4>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500 w-12">Shadow</label>
          <input
            type="range"
            min={0}
            max={Math.max(currentLevels.outWhite - 2, 0)}
            value={currentLevels.outBlack}
            onChange={(e) => updateLevel('outBlack', parseInt(e.target.value))}
            className="flex-1 h-1 accent-white"
          />
          <span className="text-xs text-gray-400 w-8 text-right">{currentLevels.outBlack}</span>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500 w-12">Highlight</label>
          <input
            type="range"
            min={Math.min(currentLevels.outBlack + 2, 255)}
            max={255}
            value={currentLevels.outWhite}
            onChange={(e) => updateLevel('outWhite', parseInt(e.target.value))}
            className="flex-1 h-1 accent-white"
          />
          <span className="text-xs text-gray-400 w-8 text-right">{currentLevels.outWhite}</span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2 flex-wrap justify-center">
        <button
          onClick={handleAutoLevels}
          className="px-3 py-1.5 text-xs bg-yellow-600 text-white rounded hover:bg-yellow-700 transition"
        >
          Auto
        </button>
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
      </div>
    </div>
  );
};

export default LevelsEditor;
