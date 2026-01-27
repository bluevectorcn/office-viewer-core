export type EditorInput = File | Blob | ArrayBuffer | string;
export type ExportFormat = "pdf" | "docx";
export type DocumentType = 'word' | 'cell' | 'slide' | 'pdf';
export type Mode = 'view' | 'edit';
export type ToolbarDocked = 'top' | 'bottom';
export type Group = string;

export interface OnlyOfficeEditor {
  open(input: EditorInput): Promise<void>;
  save(): Promise<Blob>;
  export(format: ExportFormat): Promise<Blob>;
  destroy(): void;
}

export interface CreateEditorOptions {
  lang?: string;
}

export interface Permission {
    edit?: boolean;
    download?: boolean;
    reader?: boolean;
    review?: boolean;
    print?: boolean;
    comment?: boolean;
    modifyFilter?: boolean;
    modifyContentControl?: boolean;
    fillForms?: boolean;
    copy?: boolean;
    editCommentAuthorOnly?: boolean;
    deleteCommentAuthorOnly?: boolean;
    reviewGroups?: Group[];
    commentGroups?: {
        view?: Group[];
        edit?: Group[];
        remove?: Group[];
    };
    userInfoGroups?: Group[];
    protect?: boolean;
    chat?: boolean;
}

export interface DocumentInfo {
    owner?: string;
    folder?: string;
    uploaded?: string;
    sharingSettings?: {
        user: string;
        permissions: string;
        isLink: boolean;
    }[];
    favorite?: boolean;
}

export interface DocumentConfig {
    title: string;
    url: string;
    fileType: string;
    options?: any;
    key?: string;
    vkey?: string;
    referenceData?: any;
    info?: DocumentInfo;
    permissions?: Permission;
}

export interface EditorUser {
    id: string;
    name: string;
    group?: string;
    image?: string;
    roles?: string[];
}

export interface RecentDocument {
    title: string;
    url: string;
    folder: string;
}

export interface Template {
    title: string;
    image: string;
    url: string;
}

export interface CustomizationLayout {
    toolbar?: boolean | {
        file?: boolean | {
            close?: boolean;
            settings?: boolean;
            info?: boolean;
            save?: boolean;
        };
        home?: boolean | {
            mailmerge?: boolean;
        };
        insert?: boolean | {
            file?: boolean;
            field?: boolean;
        };
        layout?: boolean | {
            pagecolor?: boolean;
        };
        references?: boolean;
        collaboration?: boolean | {
            mailmerge?: boolean;
        };
        draw?: boolean;
        protect?: boolean;
        plugins?: boolean;
        view?: boolean | {
            navigation?: boolean;
        };
        save?: boolean;
    };
    header?: boolean | {
        users?: boolean;
        save?: boolean;
        editMode?: boolean;
    };
    leftMenu?: boolean | {
        navigation?: boolean;
        spellcheck?: boolean;
        mode?: boolean;
    };
    rightMenu?: boolean | {
        mode?: boolean;
    };
    statusBar?: boolean | {
        textLang?: boolean;
        docLang?: boolean;
        actionStatus?: boolean;
    };
}

export interface CustomizationFeatures {
    spellcheck?: boolean | {
        mode?: boolean;
        change?: boolean;
    };
    roles?: boolean;
    tabStyle?: 'fill' | 'line' | {
        mode: 'fill' | 'line';
        change: boolean;
    };
    tabBackground?: 'header' | 'toolbar' | {
        mode: 'header' | 'toolbar';
        change: boolean;
    };
    featuresTips?: boolean;
}

export interface CustomizationConfig {
    logo?: {
        image?: string;
        imageDark?: string;
        imageLight?: string;
        imageEmbedded?: string;
        url?: string;
        visible?: boolean;
    };
    customer?: {
        name?: string;
        address?: string;
        mail?: string;
        www?: string;
        phone?: string;
        info?: string;
        logo?: string;
        logoDark?: string;
    };
    about?: boolean;
    feedback?: {
        visible: boolean;
        url: string;
    };
    goback?: {
        url?: string;
        text?: string;
        blank?: boolean;
        requestClose?: boolean;
    };
    close?: {
        visible: boolean;
        text: string;
    };
    reviewPermissions?: Record<string, string[]>;
    anonymous?: {
        request?: boolean;
        label?: string;
    };
    review?: {
        hideReviewDisplay?: boolean;
        hoverMode?: boolean;
        showReviewChanges?: boolean;
        reviewDisplay?: 'original' | 'markup';
        trackChanges?: boolean;
    };
    layout?: CustomizationLayout;
    features?: CustomizationFeatures;
    font?: {
        name?: string;
        size?: string;
    };
    chat?: boolean;
    comments?: boolean;
    zoom?: number;
    compactToolbar?: boolean;
    leftMenu?: boolean;
    rightMenu?: boolean;
    hideRightMenu?: boolean;
    toolbar?: boolean;
    statusBar?: boolean;
    autosave?: boolean;
    forcesave?: boolean;
    commentAuthorOnly?: boolean;
    // showReviewChanges: duplicate in review
    help?: boolean;
    compactHeader?: boolean;
    toolbarNoTabs?: boolean;
    toolbarHideFileName?: boolean;
    // reviewDisplay: duplicate in review
    // spellcheck: duplicate in features
    compatibleFeatures?: boolean;
    unit?: string;
    mentionShare?: boolean;
    macros?: boolean;
    plugins?: boolean;
    macrosMode?: 'warn' | 'enable' | 'disable';
    // trackChanges: duplicate in review
    hideRulers?: boolean;
    hideNotes?: boolean;
    uiTheme?: string;
    integrationMode?: string;
    pointerMode?: 'select' | 'hand';
    mobile?: {
        forceView?: boolean;
        standardView?: boolean;
        disableForceDesktop?: boolean;
    };
    submitForm?: {
        visible?: boolean;
        resultMessage?: string;
    };
    startFillingForm?: {
        text?: string;
    };
    slidePlayerBackground?: string;
    wordHeadingsColor?: string;
    showVerticalScroll?: boolean;
    showHorizontalScroll?: boolean;
}

export interface EditorConfig {
    actionLink?: {
        action: {
            type: "bookmark" | "comment";
            data: string;
        };
    };
    mode?: Mode;
    lang?: string;
    location?: string;
    canCoAuthoring?: boolean;
    canBackToFolder?: boolean;
    createUrl?: string;
    sharingSettingsUrl?: string;
    fileChoiceUrl?: string;
    callbackUrl?: string;
    mergeFolderUrl?: string;
    saveAsUrl?: string;
    licenseUrl?: string;
    customerId?: string;
    region?: string;
    user?: EditorUser;
    recent?: RecentDocument[];
    templates?: Template[];
    customization?: CustomizationConfig;
    coEditing?: {
        mode: 'fast' | 'strict';
        change: boolean;
    };
    plugins?: {
        autostart?: string[];
        pluginsData?: string[];
    };
    wopi?: {
        FileNameMaxLength?: number;
    };
}

export interface EventsConfig {
    onAppReady?: () => void;
    onDocumentStateChange?: (event: any) => void;
    onDocumentReady?: () => void;
    onRequestEditRights?: () => void;
    onRequestHistory?: () => void;
    onRequestHistoryData?: (data: any) => void;
    onRequestRestore?: (version: any) => void;
    onRequestHistoryClose?: () => void;
    onError?: (event: any) => void;
    onWarning?: (event: any) => void;
    onInfo?: (event: any) => void;
    onOutdatedVersion?: () => void;
    onDownloadAs?: (event: any) => void;
    onRequestSaveAs?: (event: any) => void;
    onCollaborativeChanges?: () => void;
    onRequestRename?: (event: any) => void;
    onMetaChange?: (event: any) => void;
    onRequestClose?: () => void;
    onMakeActionLink?: (event: any) => void;
    onRequestUsers?: () => void;
    onRequestSendNotify?: (event: any) => void;
    onRequestInsertImage?: (event: any) => void;
    onRequestCompareFile?: () => void;
    onRequestSharingSettings?: () => void;
    onRequestCreateNew?: () => void;
    onRequestReferenceData?: () => void;
    onRequestOpen?: (event: any) => void;
    onRequestSelectDocument?: () => void;
    onRequestSelectSpreadsheet?: () => void;
    onRequestReferenceSource?: () => void;
    onSaveDocument?: (event: any) => void;
    onRequestStartFilling?: () => void;
    onSubmit?: () => void;
    onRequestRefreshFile?: () => void;
    onUserActionRequired?: (event: any) => void;
    onRequestFillingStatus?: () => void;
    onStartFilling?: () => void;
}

export interface DocEditorConfig {
  type?: 'desktop' | 'mobile' | 'embedded';
  width?: string;
  height?: string;
  documentType?: DocumentType;
  token?: string;
  document?: DocumentConfig;
  editorConfig?: EditorConfig;
  events?: EventsConfig;
}

export interface EmbeddedConfig extends DocEditorConfig {
    type: 'embedded';
    editorConfig: EditorConfig & {
        autostart?: string;
        embedded?: {
            embedUrl?: string;
            fullscreenUrl?: string;
            saveUrl?: string;
            shareUrl?: string;
            toolbarDocked?: ToolbarDocked;
        };
    };
    events: EventsConfig & {
        onBack?: () => void;
    };
}

declare global {
  interface Window {
    DocsAPI?: {
      DocEditor: new (placeholderId: string, config: DocEditorConfig) => {
        destroyEditor?: () => void;
      };
    };
    io?: () => unknown;
    DocEditorConfig?: DocEditorConfig;
  }
}
