import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createBaseConfig } from 'office-viewer-core';
import { OnlyOfficeViewer } from 'office-viewer-core/react';

import { db, type RecentFile, type StoredFileHandle, type Template } from './db';
import { PRESET_TEMPLATES, type PresetTemplate } from './presets';
import { t } from './i18n';
import Modal, { type ModalType } from './components/Modal';

import './App.css';

type ViewState = 'home' | 'recent' | 'templates' | 'editor';
type DocumentTone = 'word' | 'sheet' | 'slide' | 'pdf' | 'template' | 'generic';
type PermissionMode = 'read' | 'readwrite';
type WritableFileStream = { write(data: Blob): Promise<void>; close(): Promise<void> };

interface ActiveDocument {
  source: 'local' | 'url' | 'template' | 'new';
  name: string;
  file?: File;
  blob?: Blob;
  url?: string;
  fileHandle?: StoredFileHandle;
  templateId?: string;
}

interface ModalState {
  isOpen: boolean;
  type: ModalType;
  message: string;
  defaultValue?: string;
  resolve?: (value?: string | boolean) => void;
}

interface PickerAcceptType {
  description?: string;
  accept: Record<string, string[]>;
}

interface PickerWindow extends Window {
  showOpenFilePicker?: (options?: {
    multiple?: boolean;
    excludeAcceptAllOption?: boolean;
    types?: PickerAcceptType[];
  }) => Promise<StoredFileHandle[]>;
  showSaveFilePicker?: (options?: {
    suggestedName?: string;
    excludeAcceptAllOption?: boolean;
    types?: PickerAcceptType[];
  }) => Promise<StoredFileHandle>;
}

interface DataTransferItemWithHandle extends DataTransferItem {
  getAsFileSystemHandle?: () => Promise<{ kind: 'file' | 'directory' } | StoredFileHandle | null>;
}

const VIEWER_CONFIG = createBaseConfig({
  document: { permissions: { edit: true, download: true } },
  editorConfig: {
    lang: 'zh',
    customization: {
      about: true,
      comments: false,
    },
  },
});

const FILE_PICKER_TYPES: PickerAcceptType[] = [
  {
    description: 'Office Documents',
    accept: {
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'application/msword': ['.doc'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel': ['.xls'],
      'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['.pptx'],
      'application/vnd.ms-powerpoint': ['.ppt'],
      'application/pdf': ['.pdf'],
    },
  },
];

const localHandleRegistry = new Map<string, StoredFileHandle>();

const SUPPORTED_BADGES = [
  { key: 'docx', label: 'DOCX', tone: 'word' as DocumentTone },
  { key: 'xlsx', label: 'XLSX', tone: 'sheet' as DocumentTone },
  { key: 'pptx', label: 'PPTX', tone: 'slide' as DocumentTone },
  { key: 'pdf', label: 'PDF', tone: 'pdf' as DocumentTone },
];

const QUICK_CREATE = [
  { ext: 'docx', titleKey: 'word_doc', tone: 'word' as DocumentTone },
  { ext: 'xlsx', titleKey: 'excel_sheet', tone: 'sheet' as DocumentTone },
  { ext: 'pptx', titleKey: 'ppt_pres', tone: 'slide' as DocumentTone },
];

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function getExtension(filename: string): string {
  const parts = filename.split('.');
  if (parts.length < 2) return '';
  return parts[parts.length - 1].toLowerCase();
}

function getToneByFilename(filename: string): DocumentTone {
  const ext = getExtension(filename);
  if (ext === 'doc' || ext === 'docx') return 'word';
  if (ext === 'xls' || ext === 'xlsx') return 'sheet';
  if (ext === 'ppt' || ext === 'pptx') return 'slide';
  if (ext === 'pdf') return 'pdf';
  return 'generic';
}

function buildFreshFilename(label: string, ext: string): string {
  return `${label}-${Date.now().toString().slice(-6)}.${ext}`;
}

function getFilenameFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const name = parsed.pathname.split('/').pop();
    if (name && name.includes('.')) return name;
  } catch {
    // Ignore invalid URLs here and fall back below.
  }

  return `${t('remote_file')}-${Date.now().toString().slice(-6)}`;
}

function formatRelativeTime(timestamp: number): string {
  const diff = timestamp - Date.now();
  const formatter = new Intl.RelativeTimeFormat(navigator.language, { numeric: 'auto' });
  const steps: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['day', 24 * 60 * 60 * 1000],
    ['hour', 60 * 60 * 1000],
    ['minute', 60 * 1000],
  ];

  for (const [unit, size] of steps) {
    const value = Math.round(diff / size);
    if (Math.abs(value) >= 1) {
      return formatter.format(value, unit);
    }
  }

  return formatter.format(0, 'second');
}

async function ensureHandlePermission(
  fileHandle: StoredFileHandle,
  mode: PermissionMode = 'read',
): Promise<boolean> {
  const descriptor = { mode };
  if (fileHandle.queryPermission) {
    const state = await fileHandle.queryPermission(descriptor);
    if (state === 'granted') return true;
  }

  if (!fileHandle.requestPermission) return true;
  return (await fileHandle.requestPermission(descriptor)) === 'granted';
}

async function writeBlobToHandle(fileHandle: StoredFileHandle, blob: Blob): Promise<void> {
  const writer = (await fileHandle.createWritable?.()) as WritableFileStream | undefined;
  if (!writer) {
    throw new Error('Writable file stream is not available.');
  }

  await writer.write(blob);
  await writer.close();
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function AppIcon({ name }: { name: string }) {
  switch (name) {
    case 'word':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M7 3.5h7l4.5 4.5V20a1 1 0 0 1-1 1H7a1.5 1.5 0 0 1-1.5-1.5V5A1.5 1.5 0 0 1 7 3.5Z" />
          <path d="M14 3.5V8h4.5" />
          <path d="M8.5 11.25 10 16l1.4-3.2L12.8 16l1.7-4.75" />
        </svg>
      );
    case 'sheet':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="5" y="3.5" width="14" height="17" rx="2" />
          <path d="M9 8.5h6M9 12h6M9 15.5h6M12 7v10" />
        </svg>
      );
    case 'slide':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="4" y="5" width="16" height="11" rx="2" />
          <path d="M12 16v3.5M8.5 20.5h7" />
        </svg>
      );
    case 'pdf':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M7 3.5h7l4.5 4.5V20a1 1 0 0 1-1 1H7a1.5 1.5 0 0 1-1.5-1.5V5A1.5 1.5 0 0 1 7 3.5Z" />
          <path d="M14 3.5V8h4.5" />
          <path d="M8.5 15.5h1.75c1 0 1.75-.7 1.75-1.6s-.75-1.65-1.75-1.65H8.5v3.25Zm5.25 0v-3.25h1.15c1.2 0 2.1.65 2.1 1.6 0 .95-.9 1.65-2.1 1.65h-1.15Z" />
        </svg>
      );
    case 'upload':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 15V4.75" />
          <path d="m7.75 9 4.25-4.25L16.25 9" />
          <path d="M6 15.75v2A2.25 2.25 0 0 0 8.25 20h7.5A2.25 2.25 0 0 0 18 17.75v-2" />
        </svg>
      );
    case 'link':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M9.25 14.75 14.75 9.25" />
          <path d="M8.5 17.5H7a3.5 3.5 0 1 1 0-7h1.5" />
          <path d="M15.5 6.5H17a3.5 3.5 0 1 1 0 7h-1.5" />
        </svg>
      );
    case 'folder':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3.5 8.25A1.75 1.75 0 0 1 5.25 6.5h4l1.4 1.75h8.1A1.75 1.75 0 0 1 20.5 10v7.75a1.75 1.75 0 0 1-1.75 1.75H5.25A1.75 1.75 0 0 1 3.5 17.75V8.25Z" />
        </svg>
      );
    case 'clock':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="8" />
          <path d="M12 8v4l2.75 2" />
        </svg>
      );
    case 'template':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="4" y="5" width="16" height="14" rx="2" />
          <path d="M8 9.25h8M8 12.5h5.5M8 15.75h7" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 4.5 19.5 8.5V15.5L12 19.5 4.5 15.5V8.5L12 4.5Z" />
        </svg>
      );
  }
}

function BrandMark() {
  return (
    <div className="brand-mark" aria-hidden="true">
      <div className="brand-mark-core">
        <div className="brand-mark-cut" />
      </div>
    </div>
  );
}

function App() {
  const [transcodeMode, setTranscodeMode] = useState<'wasm' | 'server' | 'auto'>(() => {
    return (localStorage.getItem('playground_transcode_mode') as any) || 'wasm';
  });
  const [backendUrl, setBackendUrl] = useState(() => {
    return localStorage.getItem('playground_backend_url') || 'http://localhost:3000';
  });

  useEffect(() => {
    localStorage.setItem('playground_transcode_mode', transcodeMode);
  }, [transcodeMode]);

  useEffect(() => {
    localStorage.setItem('playground_backend_url', backendUrl);
  }, [backendUrl]);

  const viewerConfig = React.useMemo(() => {
    return createBaseConfig({
      document: { permissions: { edit: true, download: true } },
      editorConfig: {
        lang: 'zh',
        customization: {
          about: true,
          comments: false,
        },
      },
      mode: transcodeMode,
      backendUrl: transcodeMode !== 'wasm' ? backendUrl : undefined,
    });
  }, [transcodeMode, backendUrl]);

  const [view, setView] = useState<ViewState>('home');
  const [activeDoc, setActiveDoc] = useState<ActiveDocument | null>(null);
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>([]);
  const [customTemplates, setCustomTemplates] = useState<Template[]>([]);
  const [urlInput, setUrlInput] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [editorVersion, setEditorVersion] = useState(0);
  const [modalState, setModalState] = useState<ModalState>({
    isOpen: false,
    type: 'alert',
    message: '',
  });

  const viewerRef = useRef<any>(null);
  const localInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void loadData();
  }, []);

  async function loadData() {
    let recents: RecentFile[] = [];
    let templates: Template[] = [];

    try {
      recents = await db.getRecentFiles();
    } catch (error) {
      console.error('Failed to load recent files. Resetting recent store.', error);
      localHandleRegistry.clear();
      try {
        await db.clearRecentFiles();
      } catch (resetError) {
        console.error('Failed to reset recent store.', resetError);
      }
    }

    try {
      templates = await db.getTemplates();
    } catch (error) {
      console.error('Failed to load templates.', error);
    }

    setRecentFiles(recents);
    setCustomTemplates(templates);
  }

  function showModal(type: ModalType, message: string, defaultValue?: string) {
    return new Promise<string | boolean | undefined>((resolve) => {
      setModalState({
        isOpen: true,
        type,
        message,
        defaultValue,
        resolve,
      });
    });
  }

  function showAlert(message: string) {
    return showModal('alert', message);
  }

  function showConfirm(message: string) {
    return showModal('confirm', message);
  }

  function showPrompt(message: string, defaultValue?: string) {
    return showModal('prompt', message, defaultValue);
  }

  function closeModal(value?: string | boolean) {
    const resolve = modalState.resolve;
    setModalState((current) => ({ ...current, isOpen: false }));
    resolve?.(value);
  }

  async function rememberDocument(doc: ActiveDocument, persistBlob = false) {
    const sourceBlob = doc.file ?? doc.blob;
    const payload = {
      name: doc.name,
      source: doc.source,
      url: doc.url,
      templateId: doc.templateId,
      extension: getExtension(doc.name),
      blob:
        doc.source === 'local'
          ? sourceBlob
          : persistBlob || doc.source === 'template'
          ? sourceBlob
          : doc.blob,
    };

    let savedRecent: RecentFile | null = null;

    try {
      savedRecent = await db.addRecentFile(payload);
    } catch (error) {
      console.error('Failed to store recent record. Resetting recent store.', error);
      localHandleRegistry.clear();
      await db.clearRecentFiles();
      if (sourceBlob || doc.source === 'url' || doc.source === 'new') {
        savedRecent = await db.addRecentFile(payload);
      }
    }

    if (savedRecent && doc.source === 'local' && doc.fileHandle) {
      localHandleRegistry.set(savedRecent.id, doc.fileHandle);
    }

    await loadData();
  }

  function openDocument(nextDoc: ActiveDocument) {
    setActiveDoc(nextDoc);
    setEditorVersion((current) => current + 1);
    setView('editor');
    void rememberDocument(nextDoc);
  }

  function handleCreateNewDocument() {
    openDocument({
      source: 'new',
      name: buildFreshFilename(t('word_doc'), 'docx'),
    });
  }

  async function openFileHandle(fileHandle: StoredFileHandle, fallbackBlob?: Blob, fallbackName?: string) {
    try {
      const granted = await ensureHandlePermission(fileHandle, 'read');
      if (!granted) {
        if (fallbackBlob && fallbackName) {
          openDocument({
            source: 'local',
            blob: fallbackBlob,
            name: fallbackName,
          });
          return true;
        }

        await showAlert(t('file_permission_denied'));
        return false;
      }

      const file = await fileHandle.getFile();
      openDocument({
        source: 'local',
        file,
        fileHandle,
        name: file.name,
      });
      return true;
    } catch (error) {
      console.error('Failed to reopen local file handle.', error);
      if (fallbackBlob && fallbackName) {
        openDocument({
          source: 'local',
          blob: fallbackBlob,
          name: fallbackName,
        });
        return true;
      }

      await showAlert(t('unsupported_local_reopen'));
      return false;
    }
  }

  async function handleOpenLocalPicker() {
    const pickerWindow = window as PickerWindow;
    if (pickerWindow.showOpenFilePicker) {
      try {
        const [fileHandle] = await pickerWindow.showOpenFilePicker({
          multiple: false,
          types: FILE_PICKER_TYPES,
        });
        if (fileHandle) {
          await openFileHandle(fileHandle);
        }
      } catch (error) {
        if (!isAbortError(error)) {
          console.error('Local file picker failed.', error);
          localInputRef.current?.click();
        }
      }
      return;
    }

    localInputRef.current?.click();
  }

  function handleLocalInput(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) {
      openDocument({
        source: 'local',
        file,
        name: file.name,
      });
    }

    event.target.value = '';
  }

  async function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);

    const firstItem = event.dataTransfer.items[0] as DataTransferItemWithHandle | undefined;
    if (firstItem?.getAsFileSystemHandle) {
      try {
        const handle = await firstItem.getAsFileSystemHandle();
        if (handle && handle.kind === 'file') {
          await openFileHandle(handle as StoredFileHandle);
          return;
        }
      } catch (error) {
        console.error('Failed to extract file handle from drag item.', error);
      }
    }

    const file = event.dataTransfer.files[0];
    if (file) {
      openDocument({
        source: 'local',
        file,
        name: file.name,
      });
    }
  }

  function handleDragOver(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (!isDragging) setIsDragging(true);
  }

  function handleDragLeave(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setIsDragging(false);
  }

  function handleUrlSubmit() {
    const nextUrl = urlInput.trim();
    if (!nextUrl) return;

    openDocument({
      source: 'url',
      url: nextUrl,
      name: getFilenameFromUrl(nextUrl),
    });
    setUrlInput('');
  }

  function handleEditorReady(editor: any) {
    if (!activeDoc) return;

    void (async () => {
      try {
        if (activeDoc.source === 'new' && !activeDoc.blob) {
          await editor.newFile(getExtension(activeDoc.name) || 'docx');
          return;
        }

        if (activeDoc.source === 'url' && activeDoc.url && !activeDoc.blob) {
          await editor.open(activeDoc.url);
          return;
        }

        const input = activeDoc.file ?? activeDoc.blob;
        if (input) {
          await editor.open(input);
        }
      } catch (error) {
        console.error('Failed to initialize editor document.', error);
        await showAlert(t('open_failed'));
        handleCloseEditor();
      }
    })();
  }

  async function getSavedResult() {
    if (!viewerRef.current) return null;
    return viewerRef.current.save(activeDoc?.name);
  }

  async function handleSaveToBrowser() {
    if (!activeDoc) return;

    try {
      const result = await getSavedResult();
      if (!result) return;

      const nextDoc: ActiveDocument = {
        ...activeDoc,
        name: result.filename,
        blob: result.blob,
      };

      setActiveDoc(nextDoc);
      await rememberDocument(nextDoc, true);
      await showAlert(t('saved_successfully'));
    } catch (error) {
      console.error('Failed to save browser snapshot.', error);
      await showAlert(t('save_failed'));
    }
  }

  async function handleSaveToLocal() {
    if (!activeDoc) return;

    try {
      const result = await getSavedResult();
      if (!result) return;

      let fileHandle = activeDoc.fileHandle;
      const pickerWindow = window as PickerWindow;

      if (!fileHandle) {
        if (!pickerWindow.showSaveFilePicker) {
          downloadBlob(result.blob, result.filename);
          return;
        }

        try {
          fileHandle = await pickerWindow.showSaveFilePicker({
            suggestedName: result.filename,
            types: FILE_PICKER_TYPES,
          });
        } catch (error) {
          if (isAbortError(error)) return;
          throw error;
        }
      }

      const granted = await ensureHandlePermission(fileHandle, 'readwrite');
      if (!granted) {
        await showAlert(t('file_permission_denied'));
        return;
      }

      await writeBlobToHandle(fileHandle, result.blob);
      const file = await fileHandle.getFile();

      const nextDoc: ActiveDocument = {
        source: 'local',
        file,
        fileHandle,
        name: file.name,
      };

      setActiveDoc(nextDoc);
      await rememberDocument(nextDoc);
      await showAlert(t('local_file_saved'));
    } catch (error) {
      console.error('Failed to save local file.', error);
      await showAlert(t('local_file_save_failed'));
    }
  }

  async function handleDownloadCopy() {
    try {
      const result = await getSavedResult();
      if (!result) return;
      downloadBlob(result.blob, result.filename);
    } catch (error) {
      console.error('Failed to download file copy.', error);
      await showAlert(t('save_failed'));
    }
  }

  async function handleSaveAsTemplate() {
    if (!activeDoc) return;

    const templateName = await showPrompt(t('enter_template_name'), activeDoc.name);
    if (!templateName || typeof templateName !== 'string') return;

    try {
      const result = await getSavedResult();
      if (!result) return;

      await db.addTemplate({
        name: templateName,
        blob: result.blob,
        date: Date.now(),
      });
      await loadData();
      await showAlert(t('template_saved'));
    } catch (error) {
      console.error('Failed to save template.', error);
      await showAlert(t('template_failed'));
    }
  }

  function handleCloseEditor() {
    setActiveDoc(null);
    setView('home');
    void loadData();
  }

  async function handleRecentClick(file: RecentFile) {
    const liveHandle = localHandleRegistry.get(file.id) ?? file.fileHandle;
    if (file.source === 'local' && liveHandle) {
      const reopened = await openFileHandle(liveHandle, file.blob, file.name);
      if (reopened) return;
    }

    if (file.blob) {
      openDocument({
        source: file.source,
        blob: file.blob,
        name: file.name,
        url: file.url,
        templateId: file.templateId,
      });
      return;
    }

    if (file.source === 'url' && file.url) {
      openDocument({
        source: 'url',
        url: file.url,
        name: file.name,
      });
      return;
    }

    if (file.source === 'new') {
      openDocument({
        source: 'new',
        name: file.name,
      });
      return;
    }

    await showAlert(t('unsupported_local_reopen'));
  }

  async function handleRenameRecent(file: RecentFile) {
    const nextName = await showPrompt(t('enter_new_name'), file.name);
    if (!nextName || typeof nextName !== 'string' || nextName === file.name) return;

    await db.updateRecentFileName(file.id, nextName);
    await loadData();
  }

  async function handleDeleteRecent(id: string) {
    localHandleRegistry.delete(id);
    await db.deleteRecentFile(id);
    await loadData();
  }

  async function handleDeleteTemplate(id: string) {
    const confirmed = await showConfirm(t('delete_template'));
    if (!confirmed) return;

    await db.deleteTemplate(id);
    await loadData();
  }

  function openPresetTemplate(template: PresetTemplate) {
    if (template.blob) {
      openDocument({
        source: 'template',
        blob: template.blob,
        name: buildFreshFilename(template.name, template.type),
        templateId: template.id,
      });
      return;
    }

    openDocument({
      source: 'new',
      name: buildFreshFilename(template.name, template.type),
      templateId: template.id,
    });
  }

  function openCustomTemplate(template: Template) {
    openDocument({
      source: 'template',
      blob: template.blob,
      name: t('untitled', [template.name]),
      templateId: template.id,
    });
  }

  function renderRecentRows(items: RecentFile[], showActions: boolean) {
    if (items.length === 0) {
      return (
        <div className="empty-panel">
          <p>{t('no_recent')}</p>
          <span>{t('recents_empty_hint')}</span>
        </div>
      );
    }

    return (
      <div className="recent-list">
        {items.map((file) => {
          const tone = getToneByFilename(file.name);
          const iconName =
            tone === 'word'
              ? 'word'
              : tone === 'sheet'
                ? 'sheet'
                : tone === 'slide'
                  ? 'slide'
                  : tone === 'pdf'
                    ? 'pdf'
                    : 'folder';

          return (
            <div className="recent-row" key={file.id} onClick={() => void handleRecentClick(file)}>
              <div className={`recent-icon tone-${tone}`}>
                <AppIcon name={iconName} />
              </div>
              <div className="recent-copy">
                <div className="recent-name">{file.name}</div>
                <div className="recent-meta">
                  <span>{t(`source_${file.source}`)}</span>
                  <span>{formatRelativeTime(file.date)}</span>
                  {file.fileHandle ? (
                    <span className="status-pill">{t('local_handle_ready')}</span>
                  ) : null}
                  {file.blob && !file.fileHandle ? (
                    <span className="status-pill muted">{t('browser_copy_ready')}</span>
                  ) : null}
                </div>
              </div>
              {showActions ? (
                <div className="recent-actions" onClick={(event) => event.stopPropagation()}>
                  <button className="secondary" onClick={() => void handleRenameRecent(file)}>
                    {t('rename')}
                  </button>
                  <button className="secondary" onClick={() => void handleDeleteRecent(file.id)}>
                    {t('remove')}
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  }

  const homeTemplates = [...customTemplates.slice(0, 2), ...PRESET_TEMPLATES].slice(0, 5);

  return (
    <div className="app-shell">
      {view !== 'editor' ? (
        <aside className="app-sidebar">
          <div className="brand">
            <BrandMark />
            <div className="brand-copy">
              <h1>{t('app_title')}</h1>
              <p>{t('app_subtitle')}</p>
            </div>
          </div>

          <div className="sidebar-actions">
            <button className="sidebar-button primary" onClick={handleCreateNewDocument}>
              + {t('create_new')}
            </button>
            <button className="sidebar-button secondary" onClick={() => void handleOpenLocalPicker()}>
              <AppIcon name="folder" />
              <span>{t('open_local')}</span>
            </button>
          </div>

          <nav className="sidebar-nav">
            <button
              className={`sidebar-link ${view === 'home' ? 'active' : ''}`}
              onClick={() => setView('home')}
            >
              <span className="sidebar-link-icon">
                <AppIcon name="upload" />
              </span>
              <span>{t('nav_home')}</span>
            </button>
            <button
              className={`sidebar-link ${view === 'recent' ? 'active' : ''}`}
              onClick={() => setView('recent')}
            >
              <span className="sidebar-link-icon">
                <AppIcon name="clock" />
              </span>
              <span>{t('nav_recent')}</span>
            </button>
            <button
              className={`sidebar-link ${view === 'templates' ? 'active' : ''}`}
              onClick={() => setView('templates')}
            >
              <span className="sidebar-link-icon">
                <AppIcon name="template" />
              </span>
              <span>{t('nav_templates')}</span>
            </button>
          </nav>

          <div className="sidebar-settings">
            <div className="sidebar-settings-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
              <span>{t('transcode_mode')}</span>
            </div>
            <div className="setting-field">
              <select
                className="setting-select"
                value={transcodeMode}
                onChange={(e) => setTranscodeMode(e.target.value as any)}
              >
                <option value="wasm">{t('mode_wasm')}</option>
                <option value="server">{t('mode_server')}</option>
                <option value="auto">{t('mode_auto')}</option>
              </select>
            </div>
            {transcodeMode !== 'wasm' && (
              <div className="setting-field">
                <label>{t('backend_url')}</label>
                <input
                  type="text"
                  className="setting-input"
                  value={backendUrl}
                  onChange={(e) => setBackendUrl(e.target.value)}
                  placeholder="http://localhost:3000"
                />
              </div>
            )}
          </div>

          <div className="sidebar-spacer" />

          <div className="sidebar-note">
            <strong>{t('workspace_tip')}</strong>
            <span>{t('continue_work_note')}</span>
          </div>

          <input
            ref={localInputRef}
            className="hidden-input"
            type="file"
            accept=".doc,.docx,.xls,.xlsx,.ppt,.pptx,.pdf"
            onChange={handleLocalInput}
          />
        </aside>
      ) : null}

      <main className={`workspace ${view === 'editor' ? 'workspace-editor' : ''}`}>
        {view !== 'editor' ? (
          <header className="workspace-topbar">
            <div>
              <div className="topbar-title">{t('nav_home')}</div>
              <div className="topbar-subtitle">{t('hero_supports')}</div>
            </div>
            <div className="format-pills">
              {SUPPORTED_BADGES.map((badge) => (
                <span key={badge.key} className={`format-pill tone-${badge.tone}`}>
                  {badge.label}
                </span>
              ))}
            </div>
          </header>
        ) : null}

        {view === 'home' ? (
          <div
            className="workspace-scroll"
            onDrop={(event) => void handleDrop(event)}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
          >
            <section className="hero-panel">
              <div className="hero-copy">
                <span className="section-kicker">{t('welcome')}</span>
                <h2>{t('hero_title')}</h2>
                <p>{t('hero_description')}</p>
                <div className="hero-actions">
                  <button onClick={() => void handleOpenLocalPicker()}>{t('choose_file')}</button>
                  <button className="secondary" onClick={() => setView('templates')}>
                    {t('open_templates')}
                  </button>
                  <button className="secondary" onClick={() => setView('recent')}>
                    {t('open_recents')}
                  </button>
                </div>
              </div>

              <div className={`hero-dropzone ${isDragging ? 'dragging' : ''}`} onClick={() => void handleOpenLocalPicker()}>
                <div className="dropzone-icon">
                  <AppIcon name="upload" />
                </div>
                <div className="dropzone-title">{t('choose_file')}</div>
                <div className="dropzone-text">{t('drop_file')}</div>
                <div className="dropzone-supports">{t('hero_supports')}</div>
              </div>

              <div className="hero-link-row">
                <div className="hero-link-icon">
                  <AppIcon name="link" />
                </div>
                <div className="hero-link-copy">
                  <div className="hero-link-title">{t('open_url')}</div>
                  <div className="hero-link-note">{t('url_hint')}</div>
                </div>
                <input
                  type="text"
                  value={urlInput}
                  placeholder={t('url_placeholder')}
                  onChange={(event) => setUrlInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') handleUrlSubmit();
                  }}
                />
                <button className="secondary" onClick={handleUrlSubmit}>
                  {t('open_url')}
                </button>
              </div>
            </section>

            <section className="section-block">
              <div className="section-header">
                <div>
                  <h3>{t('create_new')}</h3>
                  <p>{t('quick_start_note')}</p>
                </div>
              </div>
              <div className="creation-grid">
                {QUICK_CREATE.map((item) => (
                  <button
                    key={item.ext}
                    className={`creation-card tone-${item.tone}`}
                    onClick={() =>
                      openDocument({
                        source: 'new',
                        name: buildFreshFilename(t(item.titleKey), item.ext),
                      })
                    }
                  >
                    <div className="creation-icon">
                      <AppIcon
                        name={
                          item.tone === 'word'
                            ? 'word'
                            : item.tone === 'sheet'
                              ? 'sheet'
                              : 'slide'
                        }
                      />
                    </div>
                    <div className="creation-title">{t(item.titleKey)}</div>
                    <div className="creation-subtitle">{item.ext.toUpperCase()}</div>
                  </button>
                ))}
              </div>
            </section>

            <section className="section-block">
              <div className="section-header">
                <div>
                  <h3>{t('template_gallery')}</h3>
                  <p>{t('template_gallery_note')}</p>
                </div>
                <button className="section-link" onClick={() => setView('templates')}>
                  {t('nav_templates')}
                </button>
              </div>
              <div className="template-grid">
                {homeTemplates.map((template) => {
                  const isPreset = 'type' in template;
                  const templateName = template.name;
                  const tone = isPreset ? getToneByFilename(`${template.name}.${template.type}`) : 'template';

                  return (
                    <button
                      key={template.id}
                      className={`template-card tone-${tone}`}
                      onClick={() =>
                        isPreset
                          ? openPresetTemplate(template as PresetTemplate)
                          : openCustomTemplate(template as Template)
                      }
                    >
                      <div className="template-visual">
                        <span className="template-badge">
                          {isPreset ? (template as PresetTemplate).type.toUpperCase() : t('custom_templates')}
                        </span>
                        <div className="template-visual-title">{templateName}</div>
                      </div>
                      <div className="template-card-title">{templateName}</div>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="section-block">
              <div className="section-header">
                <div>
                  <h3>{t('continue_work')}</h3>
                  <p>{t('continue_work_note')}</p>
                </div>
                <button className="section-link" onClick={() => setView('recent')}>
                  {t('nav_recent')}
                </button>
              </div>
              {renderRecentRows(recentFiles.slice(0, 5), false)}
            </section>
          </div>
        ) : null}

        {view === 'recent' ? (
          <div className="workspace-scroll">
            <section className="section-block section-block-spacious">
              <div className="section-header">
                <div>
                  <h3>{t('nav_recent')}</h3>
                  <p>{t('continue_work_note')}</p>
                </div>
              </div>
              {renderRecentRows(recentFiles, true)}
            </section>
          </div>
        ) : null}

        {view === 'templates' ? (
          <div className="workspace-scroll">
            <section className="section-block section-block-spacious">
              <div className="section-header">
                <div>
                  <h3>{t('custom_templates')}</h3>
                  <p>{t('templates_empty_hint')}</p>
                </div>
              </div>
              {customTemplates.length === 0 ? (
                <div className="empty-panel">
                  <p>{t('no_custom_templates')}</p>
                  <span>{t('templates_empty_hint')}</span>
                </div>
              ) : (
                <div className="template-grid">
                  {customTemplates.map((template) => (
                    <div key={template.id} className="template-stack">
                      <button className="template-card tone-template" onClick={() => openCustomTemplate(template)}>
                        <div className="template-visual">
                          <span className="template-badge">{t('custom_templates')}</span>
                          <div className="template-visual-title">{template.name}</div>
                        </div>
                        <div className="template-card-title">{template.name}</div>
                      </button>
                      <button className="secondary template-delete" onClick={() => void handleDeleteTemplate(template.id)}>
                        {t('remove')}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="section-block section-block-spacious">
              <div className="section-header">
                <div>
                  <h3>{t('preset_templates')}</h3>
                  <p>{t('template_gallery_note')}</p>
                </div>
              </div>
              <div className="template-grid">
                {PRESET_TEMPLATES.map((template) => {
                  const tone = getToneByFilename(`${template.name}.${template.type}`);
                  return (
                    <button
                      key={template.id}
                      className={`template-card tone-${tone}`}
                      onClick={() => openPresetTemplate(template)}
                    >
                      <div className="template-visual">
                        <span className="template-badge">{template.type.toUpperCase()}</span>
                        <div className="template-visual-title">{template.name}</div>
                      </div>
                      <div className="template-card-title">{template.name}</div>
                    </button>
                  );
                })}
              </div>
            </section>
          </div>
        ) : null}

        {view === 'editor' ? (
          <div className="editor-shell">
            <div className="editor-toolbar">
              <button className="editor-back-button" onClick={handleCloseEditor}>
                {t('back')}
              </button>
              <div className="editor-title-group">
                <div className="editor-title">{activeDoc?.name}</div>
                <div className="editor-subtitle">
                  {activeDoc?.fileHandle ? t('save_hint_local') : t('save_hint_browser')}
                </div>
              </div>
              <div className="editor-actions">
                <button className="secondary" onClick={() => void handleSaveAsTemplate()}>
                  {t('save_template')}
                </button>
                <button className="secondary" onClick={() => void handleSaveToBrowser()}>
                  {t('save_to_db')}
                </button>
                <button onClick={() => void handleSaveToLocal()}>
                  {activeDoc?.fileHandle ? t('save_local') : t('save_local_as')}
                </button>
                <button className="secondary" onClick={() => void handleDownloadCopy()}>
                  {t('download_copy')}
                </button>
              </div>
            </div>

            <div className="editor-container">
              <OnlyOfficeViewer key={editorVersion} ref={viewerRef} config={viewerConfig} onEditorReady={handleEditorReady} />
            </div>
          </div>
        ) : null}
      </main>

      <Modal
        isOpen={modalState.isOpen}
        type={modalState.type}
        message={modalState.message}
        defaultValue={modalState.defaultValue}
        onConfirm={(value) => closeModal(value ?? true)}
        onCancel={() => closeModal(false)}
      />
    </div>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
