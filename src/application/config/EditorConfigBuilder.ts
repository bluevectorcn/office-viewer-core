import type {
  DocEditorConfig,
  DocumentConfig,
  EditorConfig,
  EventsConfig,
} from "../../shared/types/EditorTypes";
import type { ConvertedInput } from "../services/InputProcessingService";

type InternalEvents = {
  onAppReady: () => void;
  onDocumentReady: () => void;
  onDownloadAs: (event: unknown) => void | Promise<void>;
  onError: (event: unknown) => void;
};

const DEFAULT_CONFIG: DocEditorConfig = {
  width: "100%",
  height: "100%",
  type: "desktop",
  documentType: "word",
  document: {
    title: "document.docx",
    url: "data:,",
    fileType: "docx",
    permissions: {
      edit: true,
      print: true,
      download: true,
      fillForms: true,
      review: true,
      comment: true,
      modifyFilter: false,
      modifyContentControl: false,
      chat: false,
    },
  },
  editorConfig: {
    mode: "edit",
    lang: "zh",
    canCoAuthoring: false,
    user: {
      id: "1",
      name: "user",
      group: "user",
    },
    customization: {
      compactHeader: true,
      features: {
        spellcheck: false,
      },
    },
    coEditing: {
      mode: "strict",
      change: false,
    },
  },
};

export type BaseConfigOverrides = Omit<DocEditorConfig, "document" | "editorConfig"> & {
  document?: Partial<DocumentConfig>;
  editorConfig?: Partial<EditorConfig>;
  events?: EventsConfig;
};

function mergeBaseConfig(overrides?: BaseConfigOverrides): DocEditorConfig {
  if (!overrides) {
    const defaultDocument = DEFAULT_CONFIG.document!;
    const defaultEditorConfig = DEFAULT_CONFIG.editorConfig!;
    return {
      ...DEFAULT_CONFIG,
      document: { ...defaultDocument },
      editorConfig: { ...defaultEditorConfig },
      events: { ...(DEFAULT_CONFIG.events ?? {}) },
    };
  }

  const mergedPermissions = {
    ...(DEFAULT_CONFIG.document?.permissions ?? {}),
    ...(overrides.document?.permissions ?? {}),
  };
  const defaultDocument = DEFAULT_CONFIG.document!;
  const mergedDocumentTemp = {
    ...defaultDocument,
    ...(overrides.document ?? {}),
    permissions: mergedPermissions,
  };
  const mergedDocument: DocumentConfig = {
    ...mergedDocumentTemp,
    title: mergedDocumentTemp.title ?? defaultDocument.title,
    url: mergedDocumentTemp.url ?? defaultDocument.url,
    fileType: mergedDocumentTemp.fileType ?? defaultDocument.fileType,
  };

  const defaultEditorConfig = DEFAULT_CONFIG.editorConfig!;
  const defaultUser = defaultEditorConfig.user!;
  const mergedUser = {
    ...defaultUser,
    ...(overrides.editorConfig?.user ?? {}),
  };
  const mergedCoEditingTemp = {
    ...(defaultEditorConfig.coEditing ?? {}),
    ...(overrides.editorConfig?.coEditing ?? {}),
  };
  const mergedCoEditing = {
    mode: mergedCoEditingTemp.mode ?? defaultEditorConfig.coEditing?.mode ?? "strict",
    change: mergedCoEditingTemp.change ?? defaultEditorConfig.coEditing?.change ?? false,
  };
  const mergedCustomization = {
    ...(defaultEditorConfig.customization ?? {}),
    ...(overrides.editorConfig?.customization ?? {}),
    features: {
      ...(defaultEditorConfig.customization?.features ?? {}),
      ...(overrides.editorConfig?.customization?.features ?? {}),
    },
  };
  const mergedEditorConfigTemp = {
    ...defaultEditorConfig,
    ...(overrides.editorConfig ?? {}),
    user: mergedUser,
    coEditing: mergedCoEditing,
    customization: mergedCustomization,
  };
  const mergedEditorConfig: EditorConfig = {
    ...mergedEditorConfigTemp,
    user: {
      ...mergedEditorConfigTemp.user,
      id: mergedEditorConfigTemp.user?.id ?? defaultUser.id,
      name: mergedEditorConfigTemp.user?.name ?? defaultUser.name,
    },
    coEditing: mergedCoEditing,
  };

  return {
    ...DEFAULT_CONFIG,
    ...overrides,
    document: mergedDocument,
    editorConfig: mergedEditorConfig,
    events: {
      ...(DEFAULT_CONFIG.events ?? {}),
      ...(overrides.events ?? {}),
    },
  };
}

export function createBaseConfig(overrides?: BaseConfigOverrides): DocEditorConfig {
  return mergeBaseConfig(overrides);
}

function callSafely<T extends unknown[]>(
  handler: ((...args: T) => unknown) | undefined,
  args: T
) {
  if (!handler) return;
  try {
    handler(...args);
  } catch (error) {
    console.error("OnlyOffice event handler failed", error);
  }
}

function chainHandlers<T extends unknown[]>(
  internal: ((...args: T) => unknown) | undefined,
  external: ((...args: T) => unknown) | undefined
) {
  if (!internal && !external) return undefined;
  return (...args: T) => {
    callSafely(internal, args);
    callSafely(external, args);
  };
}

function mergeEvents(
  externalEvents: EventsConfig | undefined,
  internalEvents: InternalEvents
): EventsConfig {
  return {
    ...externalEvents,
    onAppReady: chainHandlers(internalEvents.onAppReady, externalEvents?.onAppReady),
    onDocumentReady: chainHandlers(internalEvents.onDocumentReady, externalEvents?.onDocumentReady),
    onDownloadAs: chainHandlers(internalEvents.onDownloadAs, externalEvents?.onDownloadAs),
    onError: chainHandlers(internalEvents.onError, externalEvents?.onError),
  };
}

export function buildEditorConfig(
  baseConfig: DocEditorConfig,
  resolved: ConvertedInput,
  docKey: string,
  internalEvents: InternalEvents
): DocEditorConfig {
  const { assetsPrefix: _assetsPrefix, ...restBaseConfig } = baseConfig;
  const documentConfig = {
    ...(restBaseConfig.document ?? {}),
    url: resolved.url,
    fileType: resolved.fileType,
    title: resolved.title,
    key: docKey,
  };

  const mergedEvents = mergeEvents(restBaseConfig.events, internalEvents);

  return {
    ...restBaseConfig,
    width: restBaseConfig.width ?? "100%",
    height: restBaseConfig.height ?? "100%",
    type: restBaseConfig.type ?? "desktop",
    documentType: resolved.documentType,
    document: documentConfig,
    events: mergedEvents,
  };
}
