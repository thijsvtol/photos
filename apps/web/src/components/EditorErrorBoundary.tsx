import React from 'react';
import { X } from 'lucide-react';

interface EditorErrorBoundaryProps {
  onClose: () => void;
  children: React.ReactNode;
}

interface EditorErrorBoundaryState {
  error: Error | null;
}

/**
 * Error boundary scoped to the photo/video editor.
 *
 * The editor (Filerobot + Konva) can throw during render on some platforms —
 * most notably the Android WebView, where a full-resolution photo can exhaust
 * canvas/GPU memory. Without a local boundary such a throw propagates to the
 * app-level ErrorBoundary and white-screens the entire app ("Something went
 * wrong"). This boundary keeps the failure contained, lets the user close the
 * editor and keep using the app, and — crucially on native where there is no
 * dev console — shows the actual error message + stack so the real cause is
 * visible instead of hidden.
 */
class EditorErrorBoundary extends React.Component<
  EditorErrorBoundaryProps,
  EditorErrorBoundaryState
> {
  constructor(props: EditorErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): EditorErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[Editor] Crashed:', error, info?.componentStack);
  }

  render() {
    const { error } = this.state;
    if (error) {
      const details = [error.message, error.stack].filter(Boolean).join('\n\n');
      return (
        <div className="fixed inset-0 z-[200] flex flex-col bg-gray-900 text-white">
          <div className="flex items-center justify-between px-4 py-3 bg-gray-800 border-b border-gray-700 shrink-0">
            <h2 className="font-semibold text-lg">Editor error</h2>
            <button
              onClick={this.props.onClose}
              className="text-gray-400 hover:text-white transition p-1"
              aria-label="Close editor"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="flex-1 overflow-auto p-4">
            <p className="text-red-400 font-medium mb-3">
              The editor couldn&apos;t open on this device.
            </p>
            <pre className="whitespace-pre-wrap break-words text-xs text-gray-300 bg-black/40 rounded-lg p-3 border border-gray-700">
              {details || 'Unknown error'}
            </pre>
          </div>
          <div className="p-4 border-t border-gray-700 shrink-0">
            <button
              onClick={this.props.onClose}
              className="w-full px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-medium"
            >
              Close
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default EditorErrorBoundary;
