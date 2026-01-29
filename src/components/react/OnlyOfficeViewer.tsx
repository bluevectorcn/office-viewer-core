import React, { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import { createEditor } from '../../application/EditorFactory';
import type { DocEditorConfig, IEditor, EditorInput, ExportFormat } from '../../shared/types/EditorTypes';

export interface OnlyOfficeViewerProps {
  config: DocEditorConfig;
  className?: string;
  style?: React.CSSProperties;
  onEditorReady?: (editor: IEditor) => void;
}

export interface OnlyOfficeViewerRef extends IEditor {
  container: HTMLDivElement | null;
}

export const OnlyOfficeViewer = forwardRef<OnlyOfficeViewerRef, OnlyOfficeViewerProps>(
  ({ config, className, style, onEditorReady }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const editorRef = useRef<IEditor | null>(null);

    useEffect(() => {
      if (!containerRef.current) return;

      const editor = createEditor(containerRef.current, config);
      editorRef.current = editor;

      if (onEditorReady) {
        onEditorReady(editor);
      }

      return () => {
        editor.destroy();
        editorRef.current = null;
      };
    }, [config]); // Re-create if config changes deeply? Maybe better to deep compare or manual control.
    // For now, simple effect dependency.

    useImperativeHandle(ref, () => ({
      open: async (input: EditorInput) => {
        if (!editorRef.current) throw new Error("Editor not initialized");
        return editorRef.current.open(input);
      },
      newFile: async (format: "docx" | "xlsx" | "pptx") => {
        if (!editorRef.current) throw new Error("Editor not initialized");
        return editorRef.current.newFile(format);
      },
      save: async () => {
        if (!editorRef.current) throw new Error("Editor not initialized");
        return editorRef.current.save();
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

    return <div ref={containerRef} className={className} style={{ width: '100%', height: '100%', ...style }} />;
  }
);

OnlyOfficeViewer.displayName = 'OnlyOfficeViewer';
