import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { createBaseConfig } from 'office-viewer-core';
import { OnlyOfficeViewer } from 'office-viewer-core/react';

// Storage, i18n and Presets
import { db, RecentFile, Template } from './db';
import { PRESET_TEMPLATES } from './presets';
import { t } from './i18n';
import Modal, { ModalType } from './components/Modal';

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
  
  // Custom Modal State
  const [modalConfig, setModalConfig] = useState<{
    isOpen: boolean;
    type: ModalType;
    message: string;
    defaultValue?: string;
    resolve?: (value?: any) => void;
  }>({
    isOpen: false,
    type: 'alert',
    message: '',
  });

  const viewerRef = useRef<any>(null);

  // Load data from IndexedDB
  const loadData = useCallback(async () => {
    try {
      const recents = await db.getRecentFiles();
      setRecentFiles(recents);
      const templates = await db.getTemplates();
      setCustomTemplates(templates);
    } catch (err) {
      console.error("Failed to load data from DB:", err);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, []);

  // --- Modal Helpers ---
  const showModal = useCallback((type: ModalType, message: string, defaultValue?: string): Promise<any> => {
    return new Promise((resolve) => {
      setModalConfig({
        isOpen: true,
        type,
        message,
        defaultValue,
        resolve,
      });
    });
  }, []);

  const showAlert = useCallback((msg: string) => showModal('alert', msg), [showModal]);
  const showConfirm = useCallback((msg: string) => showModal('confirm', msg), [showModal]);
  const showPrompt = useCallback((msg: string, def?: string) => showModal('prompt', msg, def), [showModal]);

  const handleModalConfirm = (value?: string) => {
    const resolve = modalConfig.resolve;
    setModalConfig(prev => ({ ...prev, isOpen: false }));
    resolve?.(value ?? true);
  };

  const handleModalCancel = () => {
    const resolve = modalConfig.resolve;
    setModalConfig(prev => ({ ...prev, isOpen: false }));
    resolve?.(false);
  };

  // --- Document Handling Actions ---

  const handleOpenDoc = useCallback(async (doc: ActiveDocument) => {
    setActiveDoc(doc);
    setView('editor');
    
    // Save to recent
    try {
      await db.addRecentFile({
        name: doc.name,
        source: doc.source,
        url: doc.url,
        blob: doc.file || doc.blob,
      });
      loadData();
    } catch (e) {
      console.error("Failed to add to recent files", e);
    }
  }, [loadData]);

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
    const name = await showPrompt(t('enter_template_name'), activeDoc?.name || "New Template");
    if (!name) return;

    try {
      const result = await viewerRef.current.save();
      if (!result) return;
      
      await db.addTemplate({
        name: name,
        blob: result.blob,
        date: Date.now()
      });
      showAlert(t('template_saved'));
      loadData();
    } catch (err) {
      console.error("Failed to save template", err);
      showAlert(t('template_failed'));
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

  const handleRenameRecent = useCallback(async (id: string, currentName: string) => {
    const newName = await showPrompt(t('enter_new_name'), currentName);
    if (newName && newName !== currentName) {
      await db.updateRecentFileName(id, newName);
      loadData();
    }
  }, [showPrompt, loadData]);

  const getFilenameFromUrl = (url: string) => {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const filename = pathname.split('/').pop();
      if (filename && filename.includes('.')) {
        return filename;
      }
    } catch (e) {
      // Invalid URL
    }
    const timestamp = new Date().getTime().toString().slice(-6);
    return `${t('remote_file')}_${timestamp}`;
  };

  const handleUrlSubmit = () => {
    if (urlInput.trim()) {
      const name = getFilenameFromUrl(urlInput.trim());
      handleOpenDoc({ source: 'url', url: urlInput.trim(), name });
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
  const config = useMemo(() => createBaseConfig({
    document: { permissions: { edit: true, download: true } },
    editorConfig: { lang: "zh", customization: { about: true, comments: false } }
  }), []);

  const renderSidebar = () => (
    <div className="sidebar">
      <h1>{t('app_title')}</h1>
      <div 
        className={`nav-item ${view === 'home' || view === 'editor' ? 'active' : ''}`}
        onClick={() => setView('home')}
      >
        {t('nav_home')}
      </div>
      <div 
        className={`nav-item ${view === 'recent' ? 'active' : ''}`}
        onClick={() => setView('recent')}
      >
        {t('nav_recent')}
      </div>
      <div 
        className={`nav-item ${view === 'templates' ? 'active' : ''}`}
        onClick={() => setView('templates')}
      >
        {t('nav_templates')}
      </div>
    </div>
  );

  const renderHomeContent = () => (
    <div className="welcome-screen" onDrop={handleDrop} onDragOver={handleDragOver} onDragLeave={handleDragLeave}>
      {isDragging && (
        <div className="drop-overlay">
          <div className="drop-overlay-content">{t('drop_file')}</div>
        </div>
      )}
      
      <h2>{t('welcome')}</h2>
      
      <div className="section">
        <h3>{t('create_new')}</h3>
        <div className="card-grid">
          <div className="card" onClick={() => handleOpenDoc({ source: 'new', name: 'document.docx' })}>
            <div className="icon">📝</div>
            <div className="title">{t('word_doc')}</div>
          </div>
          <div className="card" onClick={() => handleOpenDoc({ source: 'new', name: 'spreadsheet.xlsx' })}>
            <div className="icon">📊</div>
            <div className="title">{t('excel_sheet')}</div>
          </div>
          <div className="card" onClick={() => handleOpenDoc({ source: 'new', name: 'presentation.pptx' })}>
            <div className="icon">📽️</div>
            <div className="title">{t('ppt_pres')}</div>
          </div>
        </div>
      </div>

      <div className="section">
        <h3>{t('open_existing')}</h3>
        <div className="quick-actions">
          <button onClick={() => document.getElementById('local-file')?.click()}>
            {t('open_local')}
          </button>
          <input type="file" id="local-file" style={{ display: 'none' }} onChange={handleLocalFile} />
          
          <div style={{ display: 'flex', gap: '8px', flexGrow: 1, marginLeft: '16px' }}>
            <input 
              type="text" 
              placeholder={t('url_placeholder')} 
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleUrlSubmit()}
            />
            <button className="secondary" onClick={handleUrlSubmit}>{t('open_url')}</button>
          </div>
        </div>
      </div>
      
      {recentFiles.length > 0 && (
        <div className="section">
          <h3>{t('recent')}</h3>
          <div className="card-grid">
            {recentFiles.slice(0, 4).map(file => (
              <div className="card" key={file.id} onClick={() => {
                if (file.source === 'url' && file.url) {
                  handleOpenDoc({ source: 'url', url: file.url, name: file.name });
                } else if (file.source === 'local' && file.blob) {
                  handleOpenDoc({ source: 'local', blob: file.blob, file: file.blob as File, name: file.name });
                } else if (file.source === 'template' && file.blob) {
                  handleOpenDoc({ source: 'template', blob: file.blob, name: file.name });
                } else if (file.source === 'local') {
                  showAlert(t('open_local') + ": Browser security restrictions. Please select the file again.");
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
      <h2>{t('nav_recent')}</h2>
      <div className="list-view">
        {recentFiles.length === 0 ? (
          <p>{t('no_recent')}</p>
        ) : (
          recentFiles.map(file => (
            <div className="list-item" key={file.id} onClick={() => {
              if (file.source === 'url' && file.url) {
                handleOpenDoc({ source: 'url', url: file.url, name: file.name });
              } else if (file.source === 'local' && file.blob) {
                handleOpenDoc({ source: 'local', blob: file.blob, file: file.blob as File, name: file.name });
              } else if (file.source === 'template' && file.blob) {
                handleOpenDoc({ source: 'template', blob: file.blob, name: file.name });
              } else if (file.source === 'local') {
                showAlert(t('open_local') + ": Please select the file again.");
              } else if (file.source === 'new') {
                handleOpenDoc({ source: 'new', name: file.name });
              }
            }}>
              <div className="list-item-icon">📄</div>
              <div className="list-item-content">
                <div className="list-item-title">{file.name}</div>
                <div className="list-item-subtitle">{t('source_' + file.source)} • {new Date(file.date).toLocaleString()}</div>
              </div>
              <div className="list-item-actions">
                <button className="secondary" onClick={(e) => {
                  e.stopPropagation();
                  handleRenameRecent(file.id, file.name);
                }}>{t('rename')}</button>
                <button className="secondary" onClick={(e) => {
                  e.stopPropagation();
                  db.deleteRecentFile(file.id).then(loadData);
                }}>{t('remove')}</button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );

  const renderTemplatesView = () => (
    <div className="welcome-screen">
      <h2>{t('nav_templates')}</h2>
      
      <div className="section">
        <h3>{t('custom_templates')}</h3>
        <div className="card-grid">
          {customTemplates.length === 0 ? (
            <p style={{ color: 'var(--text-secondary)' }}>{t('no_custom_templates')}</p>
          ) : (
            customTemplates.map(tpl => (
              <div className="card" key={tpl.id} onClick={() => {
                handleOpenDoc({ source: 'template', blob: tpl.blob, name: t( 'untitled', [tpl.name]), templateId: tpl.id });
              }}>
                <div className="icon">📑</div>
                <div className="title">{tpl.name}</div>
                <div className="subtitle">
                  <button className="secondary" style={{ marginTop: '8px', padding: '4px 8px', fontSize: '12px'}} onClick={async (e) => {
                    e.stopPropagation();
                    if(await showConfirm(t('delete_template'))) {
                      db.deleteTemplate(tpl.id).then(loadData);
                    }
                  }}>{t('remove')}</button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="section">
        <h3>{t('preset_templates')}</h3>
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
              <div className="subtitle">{t('system_preset')}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const renderEditor = () => (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="editor-header">
        <button className="secondary" onClick={handleCloseEditor}>← {t('back')}</button>
        <div className="editor-header-title">{activeDoc?.name || "Document"}</div>
        <button className="secondary" onClick={handleSaveAsTemplate}>{t('save_template')}</button>
        <button onClick={handleSaveToDisk}>{t('download')}</button>
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

      <Modal
        isOpen={modalConfig.isOpen}
        type={modalConfig.type}
        message={modalConfig.message}
        defaultValue={modalConfig.defaultValue}
        onConfirm={handleModalConfirm}
        onCancel={handleModalCancel}
      />
    </div>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
