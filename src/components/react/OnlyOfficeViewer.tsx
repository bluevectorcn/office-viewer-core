import React, { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import { createEditor } from '../../application/EditorFactory';
import type { DocEditorConfig, IEditor, EditorInput, ExportFormat, LoadingStatus } from '../../shared/types/EditorTypes';

export interface OnlyOfficeViewerProps {
  config: DocEditorConfig;
  className?: string;
  style?: React.CSSProperties;
  onEditorReady?: (editor: IEditor) => void;
  /**
   * Custom loading component. Receives loading status as a prop.
   */
  loadingComponent?: React.ComponentType<{ status: LoadingStatus }>;
}

export interface OnlyOfficeViewerRef extends IEditor {
  container: HTMLDivElement | null;
}

export const OnlyOfficeViewer = forwardRef<OnlyOfficeViewerRef, OnlyOfficeViewerProps>(
  ({ config, className, style, onEditorReady, loadingComponent: LoadingComponent }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const editorRef = useRef<IEditor | null>(null);
    const [loadingStatus, setLoadingStatus] = React.useState<LoadingStatus | null>(null);

    useEffect(() => {
      if (!containerRef.current) return;

      // Wrap onLoadingStatus to update local state
      const augmentedConfig: DocEditorConfig = {
        ...config,
        events: {
          ...config.events,
          onLoadingStatus: (status) => {
            setLoadingStatus(status);
            config.events?.onLoadingStatus?.(status);
          }
        }
      };

      const editor = createEditor(containerRef.current, augmentedConfig);
      editorRef.current = editor;

      if (onEditorReady) {
        onEditorReady(editor);
      }

      return () => {
        editor.destroy();
        editorRef.current = null;
      };
    }, [config]);

    useImperativeHandle(ref, () => ({
      open: async (input: EditorInput) => {
        if (!editorRef.current) throw new Error("Editor not initialized");
        return editorRef.current.open(input);
      },
      newFile: async (format: "docx" | "xlsx" | "pptx") => {
        if (!editorRef.current) throw new Error("Editor not initialized");
        return editorRef.current.newFile(format);
      },
      save: async (filename?: string) => {
        if (!editorRef.current) throw new Error("Editor not initialized");
        return editorRef.current.save(filename);
      },
      export: async (format: ExportFormat) => {
        if (!editorRef.current) throw new Error("Editor not initialized");
        return editorRef.current.export(format);
      },
      destroy: () => {
        editorRef.current?.destroy();
      },
      container: containerRef.current
    }));

    const showMask = loadingStatus && loadingStatus.type !== 'ready';

    return (
      <div style={{ position: 'relative', width: '100%', height: '100%', ...style }} className={className}>
        <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
        {showMask && (
          <div style={{
            position: 'absolute',
            top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(255, 255, 255, 0.9)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            fontFamily: 'sans-serif'
          }}>
            {LoadingComponent ? (
              <LoadingComponent status={loadingStatus!} />
            ) : (
              <>
                <div style={{
                  width: '40px',
                  height: '40px',
                  border: '4px solid #f3f3f3',
                  borderTop: '4px solid #3498db',
                  borderRadius: '50%',
                  animation: 'oo-spin 1s linear infinite'
                }} />
                <div style={{ marginTop: '15px', color: '#333', fontWeight: 500 }}>
                  {loadingStatus!.message}
                </div>
                {loadingStatus!.progress !== undefined && (
                  <div style={{ marginTop: '10px', width: '200px', height: '4px', background: '#eee', borderRadius: '2px' }}>
                    <div style={{
                      width: `${loadingStatus!.progress}%`,
                      height: '100%',
                      background: '#3498db',
                      borderRadius: '2px',
                      transition: 'width 0.3s'
                    }} />
                  </div>
                )}
                {loadingStatus!.type === 'error' && (
                  <div style={{ marginTop: '10px', color: '#e74c3c' }}>{loadingStatus!.message}</div>
                )}
                <style>{`@keyframes oo-spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
              </>
            )}
          </div>
        )}
      </div>
    );
  }
);

OnlyOfficeViewer.displayName = 'OnlyOfficeViewer';
