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
      throw err;
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
                // Backgrounds
                'bg-primary': '#111827',
                'bg-primary-active': '#1f2937',
                'bg-primary-hover': '#1a2332',
                'bg-primary-light': '#1f2937',
                'bg-primary-stateless': '#374151',
                'bg-primary-0-5-opacity': 'rgba(17, 24, 39, 0.5)',
                'bg-secondary': '#1f2937',
                'bg-stateless': '#1f2937',
                'bg-hover': '#111827',
                'bg-active': '#1f2937',
                'bg-grey': '#374151',
                'bg-base-light': '#1e293b',
                'bg-base-medium': '#1e293b',
                'bg-tooltip': '#374151',
                // Accent
                'accent-primary': '#2563eb',
                'accent-primary-hover': '#1d4ed8',
                'accent-primary-active': '#1d4ed8',
                'accent-primary-disabled': '#374151',
                'accent-secondary-disabled': '#1f2937',
                'accent-stateless': '#2563eb',
                'accent-stateless_0_4_opacity': 'rgba(37, 99, 235, 0.4)',
                // Icons
                'icon-primary': '#d1d5db',
                'icons-primary': '#d1d5db',
                'icons-primary-opacity-0-6': 'rgba(209, 213, 219, 0.6)',
                'icons-secondary': '#9ca3af',
                'icons-placeholder': '#4b5563',
                'icons-invert': '#111827',
                'icons-muted': '#6b7280',
                'icons-primary-hover': '#f3f4f6',
                'icons-secondary-hover': '#d1d5db',
                // Text
                'txt-primary': '#f9fafb',
                'txt-secondary': '#d1d5db',
                'txt-secondary-invert': '#374151',
                'txt-placeholder': '#6b7280',
                // Buttons
                'btn-primary-text': '#ffffff',
                'btn-primary-text-0-6': 'rgba(255, 255, 255, 0.6)',
                'btn-primary-text-0-4': 'rgba(255, 255, 255, 0.4)',
                'btn-disabled-text': '#6b7280',
                'btn-secondary-text': '#d1d5db',
                // Links
                'link-primary': '#9ca3af',
                'link-stateless': '#9ca3af',
                'link-hover': '#d1d5db',
                'link-active': '#f9fafb',
                'link-pressed': '#2563eb',
                'link-muted': '#6b7280',
                // Borders
                'borders-primary': '#374151',
                'borders-primary-hover': '#4b5563',
                'borders-secondary': '#2d3748',
                'borders-strong': '#4b5563',
                'borders-invert': '#9ca3af',
                'border-hover-bottom': 'rgba(37, 99, 235, 0.18)',
                'border-active-bottom': '#1d4ed8',
                'border-primary-stateless': '#374151',
                'borders-disabled': 'rgba(37, 99, 235, 0.4)',
                'borders-button': '#6b7280',
                'borders-item': '#374151',
                // States
                warning: '#f59e0b',
                error: '#ef4444',
                'error-hover': '#dc2626',
                'error-active': '#b91c1c',
                success: '#10b981',
                'success-hover': '#059669',
                info: '#3b82f6',
                // Shadows
                'light-shadow': 'rgba(0, 0, 0, 0.3)',
                'medium-shadow': 'rgba(0, 0, 0, 0.4)',
                'large-shadow': 'rgba(0, 0, 0, 0.5)',
                'x-large-shadow': 'rgba(0, 0, 0, 0.6)',
                // Misc
                'active-secondary': '#1f2937',
                'active-secondary-hover': 'rgba(37, 99, 235, 0.1)',
                'extra-0-3-overlay': 'rgba(0, 0, 0, 0.3)',
                'extra-0-5-overlay': 'rgba(0, 0, 0, 0.5)',
                'extra-0-7-overlay': 'rgba(0, 0, 0, 0.7)',
                'extra-0-9-overlay': 'rgba(0, 0, 0, 0.9)',
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
