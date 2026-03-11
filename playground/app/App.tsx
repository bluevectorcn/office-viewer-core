import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { createBaseConfig } from 'office-viewer-core';
import { OnlyOfficeViewer } from 'office-viewer-core/react';

// Storage and Presets
import { db, RecentFile, Template } from './db';
import { PRESET_TEMPLATES } from './presets';

// Styles
import './App.css';

// --- Types ---
type ViewState = 'home' | 'recent' | 'templates' | 'editor';

interface ActiveDocument {
  source: 'local' | 'url' | 'template' | 'new';
  file?: File;
  url?: string;
  blob?: Blob;
  name: string;
  templateId?: string; // If opened from a template
}

// --- App Component ---
const App: React.FC = () => {
  const [view, setView] = useState<ViewState>('home');
  const [activeDoc, setActiveDoc] = useState<ActiveDocument | null>(null);
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>([]);
  const [customTemplates, setCustomTemplates] = useState<Template[]>([]);
  
  const [isDragging, setIsDragging] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  
  const viewerRef = useRef<any>(null);

  // Load data from IndexedDB
  const loadData = async () => {
    try {
      const recents = await db.getRecentFiles();
      setRecentFiles(recents);
      const templates = await db.getTemplates();
      setCustomTemplates(templates);
    } catch (err) {
      console.error("Failed to load data from DB:", err);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // --- Document Handling Actions ---

  const handleOpenDoc = async (doc: ActiveDocument) => {
    setActiveDoc(doc);
    setView('editor');
    
    // Save to recent
    try {
      await db.addRecentFile({
        name: doc.name,
        source: doc.source,
        url: doc.url,
      });
      loadData();
    } catch (e) {
      console.error("Failed to add to recent files", e);
    }
  };

  const onEditorReady = useCallback((editor: any) => {
    if (!activeDoc) return;
    
    if (activeDoc.source === 'new') {
      editor.newFile(activeDoc.name.split('.').pop() || 'docx');
    } else if (activeDoc.source === 'local' && activeDoc.file) {
      editor.open(activeDoc.file);
    } else if (activeDoc.source === 'url' && activeDoc.url) {
      editor.open(activeDoc.url);
    } else if (activeDoc.source === 'template' && activeDoc.blob) {
      editor.open(activeDoc.blob);
    }
  }, [activeDoc]);

  const handleCloseEditor = () => {
    setActiveDoc(null);
    setView('home');
    loadData();
  };

  const handleSaveToDisk = async () => {
    if (!viewerRef.current) return;
    try {
      const result = await viewerRef.current.save();
      if (!result) return;
      const { blob, filename } = result;
      
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Save failed", err);
      // In a real app we'd show a toast here
    }
  };

  const handleSaveAsTemplate = async () => {
    if (!viewerRef.current) return;
    const name = prompt("Enter a name for the new template:", activeDoc?.name || "New Template");
    if (!name) return;

    try {
      const result = await viewerRef.current.save();
      if (!result) return;
      
      await db.addTemplate({
        name: name,
        blob: result.blob,
        date: Date.now()
      });
      alert("Template saved successfully!");
      loadData();
    } catch (err) {
      console.error("Failed to save template", err);
      alert("Failed to save template.");
    }
  };

  // --- File Input Handlers ---
  const handleLocalFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleOpenDoc({ source: 'local', file, name: file.name });
    }
    e.target.value = '';
  };

  const handleUrlSubmit = () => {
    if (urlInput.trim()) {
      handleOpenDoc({ source: 'url', url: urlInput.trim(), name: "Remote File" });
      setUrlInput('');
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      handleOpenDoc({ source: 'local', file, name: file.name });
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };
  
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  // --- Rendering ---
  const config = createBaseConfig({
    document: { permissions: { edit: true, download: true } },
    editorConfig: { lang: "zh", customization: { about: true, comments: false } }
  });

  const renderSidebar = () => (
    <div className="sidebar">
      <h1>Office Viewer</h1>
      <div 
        className={`nav-item ${view === 'home' || view === 'editor' ? 'active' : ''}`}
        onClick={() => setView('home')}
      >
        Home
      </div>
      <div 
        className={`nav-item ${view === 'recent' ? 'active' : ''}`}
        onClick={() => setView('recent')}
      >
        Recent Files
      </div>
      <div 
        className={`nav-item ${view === 'templates' ? 'active' : ''}`}
        onClick={() => setView('templates')}
      >
        Templates
      </div>
    </div>
  );

  const renderHomeContent = () => (
    <div className="welcome-screen" onDrop={handleDrop} onDragOver={handleDragOver} onDragLeave={handleDragLeave}>
      {isDragging && (
        <div className="drop-overlay">
          <div className="drop-overlay-content">Drop file here to open...</div>
        </div>
      )}
      
      <h2>Welcome</h2>
      
      <div className="section">
        <h3>Create New</h3>
        <div className="card-grid">
          <div className="card" onClick={() => handleOpenDoc({ source: 'new', name: 'document.docx' })}>
            <div className="icon">📝</div>
            <div className="title">Word Document</div>
          </div>
          <div className="card" onClick={() => handleOpenDoc({ source: 'new', name: 'spreadsheet.xlsx' })}>
            <div className="icon">📊</div>
            <div className="title">Excel Workbook</div>
          </div>
          <div className="card" onClick={() => handleOpenDoc({ source: 'new', name: 'presentation.pptx' })}>
            <div className="icon">📽️</div>
            <div className="title">PowerPoint</div>
          </div>
        </div>
      </div>

      <div className="section">
        <h3>Open Existing</h3>
        <div className="quick-actions">
          <button onClick={() => document.getElementById('local-file')?.click()}>
            Open Local File
          </button>
          <input type="file" id="local-file" style={{ display: 'none' }} onChange={handleLocalFile} />
          
          <div style={{ display: 'flex', gap: '8px', flexGrow: 1, marginLeft: '16px' }}>
            <input 
              type="text" 
              placeholder="Enter remote file URL..." 
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleUrlSubmit()}
            />
            <button className="secondary" onClick={handleUrlSubmit}>Open URL</button>
          </div>
        </div>
      </div>
      
      {recentFiles.length > 0 && (
        <div className="section">
          <h3>Recent</h3>
          <div className="card-grid">
            {recentFiles.slice(0, 4).map(file => (
              <div className="card" key={file.id} onClick={() => {
                // If it's a URL source, we can reopen easily.
                // If it's pure "local" name without URL/blob, we might not be able to immediately reopen
                // due to browser security preventing auto-loading local paths without a picker.
                if (file.source === 'url' && file.url) {
                  handleOpenDoc({ source: 'url', url: file.url, name: file.name });
                } else if (file.source === 'local') {
                  alert("Local files cannot be reopened directly due to browser security restrictions. Please select the file again.");
                } else if (file.source === 'new') {
                   handleOpenDoc({ source: 'new', name: file.name });
                }
              }}>
                <div className="icon">📄</div>
                <div className="title">{file.name}</div>
                <div className="subtitle">{new Date(file.date).toLocaleDateString()}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  const renderRecentView = () => (
    <div className="welcome-screen">
      <h2>Recent Files</h2>
      <div className="list-view">
        {recentFiles.length === 0 ? (
          <p>No recent files found.</p>
        ) : (
          recentFiles.map(file => (
            <div className="list-item" key={file.id} onClick={() => {
              if (file.source === 'url' && file.url) {
                handleOpenDoc({ source: 'url', url: file.url, name: file.name });
              } else if (file.source === 'local') {
                alert("Local files cannot be reopened directly without file selection.");
              } else if (file.source === 'new') {
                handleOpenDoc({ source: 'new', name: file.name });
              }
            }}>
              <div className="list-item-icon">📄</div>
              <div className="list-item-content">
                <div className="list-item-title">{file.name}</div>
                <div className="list-item-subtitle">{file.source.toUpperCase()} • {new Date(file.date).toLocaleString()}</div>
              </div>
              <div className="list-item-actions">
                <button className="secondary" onClick={(e) => {
                  e.stopPropagation();
                  db.deleteRecentFile(file.id).then(loadData);
                }}>Remove</button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );

  const renderTemplatesView = () => (
    <div className="welcome-screen">
      <h2>Templates</h2>
      
      <div className="section">
        <h3>Custom Templates</h3>
        <div className="card-grid">
          {customTemplates.length === 0 ? (
            <p style={{ color: 'var(--text-secondary)' }}>No custom templates saved yet.</p>
          ) : (
            customTemplates.map(tpl => (
              <div className="card" key={tpl.id} onClick={() => {
                handleOpenDoc({ source: 'template', blob: tpl.blob, name: `Untitled from ${tpl.name}`, templateId: tpl.id });
              }}>
                <div className="icon">📑</div>
                <div className="title">{tpl.name}</div>
                <div className="subtitle">
                  <button className="secondary" style={{ marginTop: '8px', padding: '4px 8px', fontSize: '12px'}} onClick={(e) => {
                    e.stopPropagation();
                    if(confirm("Delete this template?")) {
                      db.deleteTemplate(tpl.id).then(loadData);
                    }
                  }}>Delete</button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="section">
        <h3>Preset Templates</h3>
        <div className="card-grid">
          {PRESET_TEMPLATES.map(tpl => (
            <div className="card" key={tpl.id} onClick={() => {
              if (tpl.blob) {
                handleOpenDoc({ source: 'template', blob: tpl.blob, name: `Untitled from ${tpl.name}` });
              } else {
                handleOpenDoc({ source: 'new', name: `document.${tpl.type}` });
              }
            }}>
              <div className="icon">
                {tpl.type === 'docx' ? '📝' : tpl.type === 'xlsx' ? '📊' : '📽️'}
              </div>
              <div className="title">{tpl.name}</div>
              <div className="subtitle">System Preset</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const renderEditor = () => (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="editor-header">
        <button className="secondary" onClick={handleCloseEditor}>← Back</button>
        <div className="editor-header-title">{activeDoc?.name || "Document"}</div>
        <button className="secondary" onClick={handleSaveAsTemplate}>Save as Template</button>
        <button onClick={handleSaveToDisk}>Download</button>
      </div>
      <div className="editor-container">
        <OnlyOfficeViewer
          ref={viewerRef}
          config={config}
          onEditorReady={onEditorReady}
        />
      </div>
    </div>
  );

  return (
    <div className="app-container">
      {view !== 'editor' && renderSidebar()}
      
      <div className="main-area">
        {view === 'home' && renderHomeContent()}
        {view === 'recent' && renderRecentView()}
        {view === 'templates' && renderTemplatesView()}
        {view === 'editor' && renderEditor()}
      </div>
    </div>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
