import React, { useState, useRef, useEffect } from 'react';
import { X, Scissors, Crop, RotateCw, Radio, Loader2, AlertCircle } from 'lucide-react';
import { applyVideoTransformations, initFFmpeg, unloadFFmpeg } from '../utils/videoEditing';

type EditorTab = 'trim' | 'crop' | 'transform' | 'speed';

interface VideoEditorModalProps {
  videoUrl: string;
  onSave: (editedBlob: Blob) => Promise<void>;
  onClose: () => void;
}

const VideoEditorModal: React.FC<VideoEditorModalProps> = ({ videoUrl, onSave, onClose }) => {
  const [activeTab, setActiveTab] = useState<EditorTab>('trim');
  const [saving, setSaving] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoDuration, setVideoDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);

  // Trim state
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);

  // Crop state
  const [cropMode, setCropMode] = useState(false);
  const cropX = 0;
  const cropY = 0;
  const [cropWidth, setCropWidth] = useState(0);
  const [cropHeight, setCropHeight] = useState(0);
  const [selectedAspectRatio, setSelectedAspectRatio] = useState<string>('custom');

  // Transform state
  const [rotation, setRotation] = useState(0); // 0, 1, 2, or 3 (0°, 90°, 180°, 270°)
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);

  // Speed state
  const [speed, setSpeed] = useState(1);

  // Initialize video metadata and FFmpeg
  useEffect(() => {
    const initializeEditor = async () => {
      try {
        setError(null);
        
        // Initialize FFmpeg (lazy load)
        await initFFmpeg();
        
        // Wait for video metadata
        if (videoRef.current) {
          videoRef.current.onloadedmetadata = () => {
            const duration = videoRef.current!.duration;
            setVideoDuration(duration);
            setTrimEnd(duration);
            
            // Initialize crop to full video dimensions
            if (videoRef.current?.videoWidth && videoRef.current?.videoHeight) {
              setCropWidth(videoRef.current.videoWidth);
              setCropHeight(videoRef.current.videoHeight);
            }
          };
        }
        
        setInitializing(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to initialize video editor');
        setInitializing(false);
      }
    };

    initializeEditor();

    return () => {
      // Cleanup FFmpeg when modal closes
      unloadFFmpeg().catch(() => {});
    };
  }, [videoUrl]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);

    try {
      // Fetch original video blob
      const response = await fetch(videoUrl);
      const videoBlob = await response.blob();

      // Apply all transformations
      const editedBlob = await applyVideoTransformations(videoBlob, {
        trim: trimStart !== 0 || trimEnd !== videoDuration ? { startTime: trimStart, endTime: trimEnd } : undefined,
        crop: cropMode && (cropX !== 0 || cropY !== 0 || cropWidth !== videoRef.current?.videoWidth || cropHeight !== videoRef.current?.videoHeight)
          ? { startX: cropX, startY: cropY, width: cropWidth, height: cropHeight }
          : undefined,
        rotate: rotation > 0 ? rotation : undefined,
        speed: speed !== 1 ? speed : undefined,
      });

      await onSave(editedBlob);
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save video';
      setError(message);
      console.error(message, err);
    } finally {
      setSaving(false);
    }
  };

  const handleTimeUpdate = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    setCurrentTime(time);
    if (videoRef.current) {
      videoRef.current.currentTime = time;
    }
  };

  const handleTrimStart = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(e.target.value);
    setTrimStart(Math.min(value, trimEnd - 0.1));
  };

  const handleTrimEnd = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(e.target.value);
    setTrimEnd(Math.max(value, trimStart + 0.1));
  };

  const handleAspectRatioClick = (ratio: string, aspectValue?: number) => {
    setSelectedAspectRatio(ratio);
    if (!videoRef.current) return;

    const videoWidth = videoRef.current.videoWidth;
    const videoHeight = videoRef.current.videoHeight;

    if (ratio === 'custom') {
      setCropWidth(videoWidth);
      setCropHeight(videoHeight);
    } else if (aspectValue) {
      // Calculate new dimensions based on aspect ratio
      const maxWidth = videoWidth;
      const maxHeight = videoHeight;
      let newWidth = maxWidth;
      let newHeight = maxWidth / aspectValue;

      if (newHeight > maxHeight) {
        newHeight = maxHeight;
        newWidth = maxHeight * aspectValue;
      }

      setCropWidth(Math.round(newWidth));
      setCropHeight(Math.round(newHeight));
    }
  };

  const tabs: { key: EditorTab; label: string; icon: React.ReactNode }[] = [
    { key: 'trim', label: 'Trim', icon: <Scissors className="w-4 h-4" /> },
    { key: 'crop', label: 'Crop', icon: <Crop className="w-4 h-4" /> },
    { key: 'transform', label: 'Transform', icon: <RotateCw className="w-4 h-4" /> },
    { key: 'speed', label: 'Speed', icon: <Radio className="w-4 h-4" /> },
  ];

  const formatTime = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return `${hrs ? hrs + ':' : ''}${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  if (initializing) {
    return (
      <div className="fixed inset-0 z-[200] flex items-center justify-center bg-gray-900">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-white"></div>
          <p className="mt-4 text-gray-400">Loading video editor...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[200] flex flex-col bg-gray-900">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gray-800 border-b border-gray-700 shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition p-1"
            aria-label="Close editor"
          >
            <X className="w-5 h-5" />
          </button>
          <h2 className="text-white font-semibold text-lg">Edit Video</h2>
        </div>

        {/* Tab switcher */}
        <div className="flex gap-1">
          {tabs.map(({ key, label, icon }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition ${
                activeTab === key
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              {icon}
              <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>

        {/* Save button */}
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition font-medium text-sm"
        >
          {saving ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Processing...
            </>
          ) : (
            'Save Changes'
          )}
        </button>
      </div>

      {/* Error message */}
      {error && (
        <div className="bg-red-900 border-b border-red-700 text-red-100 px-4 py-3 flex items-gap-3 gap-2">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Error</p>
            <p className="text-sm">{error}</p>
          </div>
        </div>
      )}

      {/* Editor Body */}
      <div className="flex-1 overflow-hidden relative min-h-0 bg-black">
        {/* Video Preview */}
        <div className="absolute inset-0 flex items-center justify-center">
          <video
            ref={videoRef}
            src={videoUrl}
            controls={false}
            className="max-w-full max-h-full object-contain"
            style={{
              transform: `rotate(${rotation * 90}deg) ${flipH ? 'scaleX(-1)' : ''} ${flipV ? 'scaleY(-1)' : ''}`,
            }}
          />
        </div>

        {/* Controls Panel */}
        <div className="absolute bottom-0 left-0 right-0 bg-gray-800 border-t border-gray-700 p-4 max-h-1/3 overflow-y-auto">
          {/* Timeline Scrubber */}
          <div className="mb-4">
            <div className="flex justify-between text-xs text-gray-400 mb-2">
              <span>{formatTime(currentTime)}</span>
              <span>{formatTime(videoDuration)}</span>
            </div>
            <input
              type="range"
              min="0"
              max={videoDuration}
              value={currentTime}
              onChange={handleTimeUpdate}
              step="0.1"
              className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-600"
            />
          </div>

          {/* Trim Tab */}
          {activeTab === 'trim' && (
            <div className="space-y-4">
              <h3 className="text-white font-medium text-sm">Trim Video</h3>
              
              <div>
                <label className="block text-gray-400 text-xs mb-2">Start Time: {formatTime(trimStart)}</label>
                <input
                  type="range"
                  min="0"
                  max={videoDuration}
                  value={trimStart}
                  onChange={handleTrimStart}
                  step="0.1"
                  className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-600"
                />
              </div>

              <div>
                <label className="block text-gray-400 text-xs mb-2">End Time: {formatTime(trimEnd)}</label>
                <input
                  type="range"
                  min="0"
                  max={videoDuration}
                  value={trimEnd}
                  onChange={handleTrimEnd}
                  step="0.1"
                  className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-600"
                />
              </div>

              <p className="text-gray-400 text-xs">Output duration: {formatTime(trimEnd - trimStart)}</p>
            </div>
          )}

          {/* Crop Tab */}
          {activeTab === 'crop' && (
            <div className="space-y-4">
              <h3 className="text-white font-medium text-sm">Crop Video</h3>

              <div>
                <label className="flex items-center gap-2 mb-3">
                  <input
                    type="checkbox"
                    checked={cropMode}
                    onChange={(e) => setCropMode(e.target.checked)}
                    className="w-4 h-4 rounded accent-blue-600 cursor-pointer"
                  />
                  <span className="text-gray-300 text-sm">Enable crop</span>
                </label>
              </div>

              {cropMode && (
                <>
                  <div>
                    <label className="block text-gray-400 text-xs mb-2">Aspect Ratio</label>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { label: 'Free', value: 'custom' },
                        { label: '1:1', value: '1' },
                        { label: '4:3', value: '4/3' },
                        { label: '3:2', value: '3/2' },
                        { label: '16:9', value: '16/9' },
                        { label: '9:16', value: '9/16' },
                      ].map(({ label, value }) => (
                        <button
                          key={value}
                          onClick={() => {
                            if (value === 'custom') {
                              handleAspectRatioClick('custom');
                            } else {
                              handleAspectRatioClick(value, parseFloat(value));
                            }
                          }}
                          className={`px-2 py-1 text-xs rounded transition ${
                            selectedAspectRatio === value
                              ? 'bg-blue-600 text-white'
                              : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-gray-400 text-xs mb-1">Width: {cropWidth}px</label>
                      <input
                        type="range"
                        min="1"
                        max={videoRef.current?.videoWidth || 1920}
                        value={cropWidth}
                        onChange={(e) => setCropWidth(parseInt(e.target.value))}
                        className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-600"
                      />
                    </div>
                    <div>
                      <label className="block text-gray-400 text-xs mb-1">Height: {cropHeight}px</label>
                      <input
                        type="range"
                        min="1"
                        max={videoRef.current?.videoHeight || 1080}
                        value={cropHeight}
                        onChange={(e) => setCropHeight(parseInt(e.target.value))}
                        className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-600"
                      />
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Transform Tab */}
          {activeTab === 'transform' && (
            <div className="space-y-4">
              <h3 className="text-white font-medium text-sm">Transform Video</h3>

              <div>
                <label className="block text-gray-400 text-xs mb-2">
                  Rotation: {rotation * 90}°
                </label>
                <div className="flex gap-2">
                  {[0, 1, 2, 3].map((r) => (
                    <button
                      key={r}
                      onClick={() => setRotation(r)}
                      className={`px-3 py-1 text-sm rounded transition ${
                        rotation === r
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                      }`}
                    >
                      {r * 90}°
                    </button>
                  ))}
                </div>
              </div>

              <div className="pt-2">
                <label className="block text-gray-400 text-xs mb-3">Flip</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setFlipH(!flipH)}
                    className={`flex-1 px-3 py-2 text-sm rounded transition ${
                      flipH
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
                  >
                    ↔️ Horizontal
                  </button>
                  <button
                    onClick={() => setFlipV(!flipV)}
                    className={`flex-1 px-3 py-2 text-sm rounded transition ${
                      flipV
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
                  >
                    ↕️ Vertical
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Speed Tab */}
          {activeTab === 'speed' && (
            <div className="space-y-4">
              <h3 className="text-white font-medium text-sm">Speed</h3>

              <div>
                <label className="block text-gray-400 text-xs mb-2">Playback Speed: {speed.toFixed(2)}x</label>
                <input
                  type="range"
                  min="0.5"
                  max="2"
                  value={speed}
                  onChange={(e) => setSpeed(parseFloat(e.target.value))}
                  step="0.1"
                  className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-600"
                />
              </div>

              <div className="grid grid-cols-4 gap-2">
                {[0.5, 1, 1.5, 2].map((s) => (
                  <button
                    key={s}
                    onClick={() => setSpeed(s)}
                    className={`px-2 py-1 text-xs rounded transition ${
                      speed === s
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
                  >
                    {s}x
                  </button>
                ))}
              </div>

              <p className="text-gray-400 text-xs">
                Original duration: {formatTime(videoDuration)} → 
                New duration: {formatTime(videoDuration / speed)}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default VideoEditorModal;
