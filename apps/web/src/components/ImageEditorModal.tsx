import React, { useState, useRef, useCallback, useEffect } from 'react';
import FilerobotImageEditor, { TABS, TOOLS } from 'react-filerobot-image-editor';
import { X, Sliders, TrendingUp, BarChart3, Loader2 } from 'lucide-react';
import CurvesEditor from './editor/CurvesEditor';
import LevelsEditor from './editor/LevelsEditor';

type EditorTab = 'adjust' | 'curves' | 'levels';

interface ImageEditorModalProps {
  imageUrl: string;
  onSave: (editedBlob: Blob) => Promise<void>;
  onClose: () => void;
}

function canvasToImageData(canvas: HTMLCanvasElement): ImageData {
  const ctx = canvas.getContext('2d')!;
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

function imageDataToCanvas(imageData: ImageData): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext('2d')!;
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

function canvasToBlob(canvas: HTMLCanvasElement, quality = 0.92): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Failed to export canvas to blob'));
      },
      'image/jpeg',
      quality
    );
  });
}

const ImageEditorModal: React.FC<ImageEditorModalProps> = ({ imageUrl, onSave, onClose }) => {
  const [activeTab, setActiveTab] = useState<EditorTab>('adjust');
  const [saving, setSaving] = useState(false);
  const [editedCanvas, setEditedCanvas] = useState<HTMLCanvasElement | null>(null);
  const [curvesLevelsImageData, setCurvesLevelsImageData] = useState<ImageData | null>(null);
  const [previewCanvas, setPreviewCanvas] = useState<HTMLCanvasElement | null>(null);
  const getCurrentImgDataRef = useRef<any>(null);

  // Load original image into a canvas for curves/levels tab when no Filerobot edit has been done
  useEffect(() => {
    if (!editedCanvas) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        setCurvesLevelsImageData(canvasToImageData(canvas));
        setPreviewCanvas(canvas);
      };
      img.src = imageUrl;
    }
  }, [imageUrl, editedCanvas]);

  const handleFilerobotSave = useCallback(
    (savedImageData: any) => {
      if (savedImageData.imageCanvas) {
        const canvas = savedImageData.imageCanvas as HTMLCanvasElement;
        setEditedCanvas(canvas);
        setCurvesLevelsImageData(canvasToImageData(canvas));
        setPreviewCanvas(canvas);
      }
    },
    []
  );

  const handleCurvesApply = useCallback((result: ImageData) => {
    const canvas = imageDataToCanvas(result);
    setCurvesLevelsImageData(result);
    setPreviewCanvas(canvas);
    setEditedCanvas(canvas);
  }, []);

  const handleLevelsApply = useCallback((result: ImageData) => {
    const canvas = imageDataToCanvas(result);
    setCurvesLevelsImageData(result);
    setPreviewCanvas(canvas);
    setEditedCanvas(canvas);
  }, []);

  const handleFinalSave = async () => {
    setSaving(true);
    try {
      let canvasToExport: HTMLCanvasElement;

      if (editedCanvas) {
        canvasToExport = editedCanvas;
      } else if (getCurrentImgDataRef.current) {
        // Get the current state from Filerobot without triggering its save UI
        const { imageData } = getCurrentImgDataRef.current(
          { quality: 0.92 },
          false,
          true
        );
        if (imageData?.imageCanvas) {
          canvasToExport = imageData.imageCanvas;
        } else {
          throw new Error('Could not retrieve edited image data');
        }
      } else {
        throw new Error('No edits to save');
      }

      const blob = await canvasToBlob(canvasToExport, 0.92);
      await onSave(blob);
    } catch (err) {
      console.error('Failed to save:', err);
    } finally {
      setSaving(false);
    }
  };

  const tabs: { key: EditorTab; label: string; icon: React.ReactNode }[] = [
    { key: 'adjust', label: 'Adjust', icon: <Sliders className="w-4 h-4" /> },
    { key: 'curves', label: 'Curves', icon: <TrendingUp className="w-4 h-4" /> },
    { key: 'levels', label: 'Levels', icon: <BarChart3 className="w-4 h-4" /> },
  ];

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
          <h2 className="text-white font-semibold text-lg">Edit Photo</h2>
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
          onClick={handleFinalSave}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition font-medium text-sm"
        >
          {saving ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Saving...
            </>
          ) : (
            'Save Changes'
          )}
        </button>
      </div>

      {/* Editor Body */}
      <div className="flex-1 overflow-hidden relative min-h-0">
        {/* Filerobot Adjust Tab */}
        <div className={`absolute inset-0 ${activeTab === 'adjust' ? '' : 'invisible pointer-events-none'}`}>
          <FilerobotImageEditor
            source={editedCanvas ? editedCanvas.toDataURL('image/jpeg', 0.92) : imageUrl}
            tabsIds={[TABS.FINETUNE, TABS.ADJUST]}
            defaultTabId={TABS.FINETUNE}
            defaultToolId={TOOLS.CROP}
            onSave={handleFilerobotSave}
            onClose={() => {/* Don't close, let our wrapper handle it */}}
            Crop={{
              presetsItems: [
                { titleKey: 'Free', ratio: 'custom' as any, noEffect: true },
                { titleKey: '1:1', ratio: 1, width: 1, height: 1 },
                { titleKey: '4:3', ratio: 4 / 3, width: 4, height: 3 },
                { titleKey: '3:2', ratio: 3 / 2, width: 3, height: 2 },
                { titleKey: '16:9', ratio: 16 / 9, width: 16, height: 9 },
                { titleKey: '9:16', ratio: 9 / 16, width: 9, height: 16 },
                { titleKey: '4:5', ratio: 4 / 5, width: 4, height: 5 },
              ],
            }}
            Rotate={{
              componentType: 'slider',
            }}
            savingPixelRatio={1}
            previewPixelRatio={1}
            defaultSavedImageType="jpeg"
            defaultSavedImageQuality={0.92}
            observePluginContainerSize
            showBackButton={false}
            closeAfterSave={false}
            avoidChangesNotSavedAlertOnLeave
            getCurrentImgDataFnRef={getCurrentImgDataRef}
            theme={{
              palette: {
                'bg-primary': '#111827',
                'bg-primary-active': '#1f2937',
                'bg-secondary': '#1f2937',
                'accent-primary': '#2563eb',
                'accent-primary-active': '#1d4ed8',
                'icons-primary': '#d1d5db',
                'icons-secondary': '#9ca3af',
                'borders-primary': '#374151',
                'borders-secondary': '#4b5563',
                'txt-primary': '#f9fafb',
                'txt-secondary': '#d1d5db',
                'txt-placeholder': '#6b7280',
                'btn-primary-text': '#ffffff',
                warning: '#f59e0b',
                error: '#ef4444',
              },
              typography: {
                fontFamily: 'inherit',
              },
            }}
          />
        </div>

        {/* Curves Tab */}
        {activeTab === 'curves' && (
          <div className="flex flex-col md:flex-row h-full">
            {/* Preview */}
            <div className="flex-1 flex items-center justify-center bg-black p-4 overflow-auto">
              {previewCanvas ? (
                <img
                  src={previewCanvas.toDataURL('image/jpeg', 0.85)}
                  alt="Preview"
                  className="max-w-full max-h-full object-contain"
                />
              ) : (
                <div className="text-gray-400">Loading preview...</div>
              )}
            </div>
            {/* Controls */}
            <div className="w-full md:w-80 bg-gray-800 p-4 overflow-y-auto border-t md:border-t-0 md:border-l border-gray-700">
              <h3 className="text-white font-medium text-sm mb-3">Curves</h3>
              {curvesLevelsImageData ? (
                <CurvesEditor
                  imageData={curvesLevelsImageData}
                  onApply={handleCurvesApply}
                />
              ) : (
                <p className="text-gray-400 text-sm">Loading image data...</p>
              )}
            </div>
          </div>
        )}

        {/* Levels Tab */}
        {activeTab === 'levels' && (
          <div className="flex flex-col md:flex-row h-full">
            {/* Preview */}
            <div className="flex-1 flex items-center justify-center bg-black p-4 overflow-auto">
              {previewCanvas ? (
                <img
                  src={previewCanvas.toDataURL('image/jpeg', 0.85)}
                  alt="Preview"
                  className="max-w-full max-h-full object-contain"
                />
              ) : (
                <div className="text-gray-400">Loading preview...</div>
              )}
            </div>
            {/* Controls */}
            <div className="w-full md:w-80 bg-gray-800 p-4 overflow-y-auto border-t md:border-t-0 md:border-l border-gray-700">
              <h3 className="text-white font-medium text-sm mb-3">Levels</h3>
              {curvesLevelsImageData ? (
                <LevelsEditor
                  imageData={curvesLevelsImageData}
                  onApply={handleLevelsApply}
                />
              ) : (
                <p className="text-gray-400 text-sm">Loading image data...</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ImageEditorModal;
