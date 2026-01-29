export type EditorInput = File | Blob | ArrayBuffer | string;
export type ExportFormat = "pdf" | "docx" | "xlsx" | "pptx";
export type DocumentType = 'word' | 'cell' | 'slide' | 'pdf';
export type Mode = 'view' | 'edit';
export type ToolbarDocked = 'top' | 'bottom';
export type Group = string;

export type LoadingType = 'loading' | 'converting' | 'initing' | 'ready' | 'error';

export interface LoadingStatus {
    type: LoadingType;
    message: string;
    progress?: number;
}

export interface IEditor {
  open(input: EditorInput): Promise<void>;
  newFile(format: "docx" | "xlsx" | "pptx"): Promise<void>;
  save(filename?: string): Promise<{ blob: Blob; filename: string }>;
  export(format: ExportFormat): Promise<Blob>;
  destroy(): void;
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
    title?: string;
    url?: string;
    fileType?: string;
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
    // chat?: boolean;
    comments?: boolean;
    zoom?: number;
    compactToolbar?: boolean;
    // leftMenu?: boolean;
    // rightMenu?: boolean;
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
    // spellcheck?: boolean;
    compatibleFeatures?: boolean;
    unit?: string;
    mentionShare?: boolean;
    macros?: boolean;
    plugins?: boolean;
    macrosMode?: 'warn' | 'enable' | 'disable';
    // trackChanges: duplicate in review
    hideRulers?: boolean;
    hideNotes?: boolean;
    uiTheme?: OfficeTheme;
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
    onLoadingStatus?: (status: LoadingStatus) => void;
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
  /**
   * Static assets prefix used by the component to load api.js and x2t.js.
   * This field is stripped before passing the config to DocsAPI.
   */
  assetsPrefix?: string;
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

export type OfficeTheme =
  | "theme-light"
  | "theme-classic-light"
  | "theme-white"
  | "theme-dark"
  | "theme-night"
  | "theme-contrast-dark";

export const enum AvsFileType {
  AVS_FILE_UNKNOWN = 0x0000,

  // Document
  AVS_FILE_DOCUMENT = 0x0040,
  AVS_FILE_DOCUMENT_DOCX = AVS_FILE_DOCUMENT + 0x0001,
  AVS_FILE_DOCUMENT_DOC = AVS_FILE_DOCUMENT + 0x0002,
  AVS_FILE_DOCUMENT_ODT = AVS_FILE_DOCUMENT + 0x0003,
  AVS_FILE_DOCUMENT_RTF = AVS_FILE_DOCUMENT + 0x0004,
  AVS_FILE_DOCUMENT_TXT = AVS_FILE_DOCUMENT + 0x0005,
  AVS_FILE_DOCUMENT_HTML = AVS_FILE_DOCUMENT + 0x0006,
  AVS_FILE_DOCUMENT_MHT = AVS_FILE_DOCUMENT + 0x0007,
  AVS_FILE_DOCUMENT_EPUB = AVS_FILE_DOCUMENT + 0x0008,
  AVS_FILE_DOCUMENT_FB2 = AVS_FILE_DOCUMENT + 0x0009,
  AVS_FILE_DOCUMENT_MOBI = AVS_FILE_DOCUMENT + 0x000a,
  AVS_FILE_DOCUMENT_DOCM = AVS_FILE_DOCUMENT + 0x000b,
  AVS_FILE_DOCUMENT_DOTX = AVS_FILE_DOCUMENT + 0x000c,
  AVS_FILE_DOCUMENT_DOTM = AVS_FILE_DOCUMENT + 0x000d,
  AVS_FILE_DOCUMENT_ODT_FLAT = AVS_FILE_DOCUMENT + 0x000e,
  AVS_FILE_DOCUMENT_OTT = AVS_FILE_DOCUMENT + 0x000f,
  AVS_FILE_DOCUMENT_DOC_FLAT = AVS_FILE_DOCUMENT + 0x0010,
  AVS_FILE_DOCUMENT_DOCX_FLAT = AVS_FILE_DOCUMENT + 0x0011,
  AVS_FILE_DOCUMENT_HTML_IN_CONTAINER = AVS_FILE_DOCUMENT + 0x0012,
  AVS_FILE_DOCUMENT_DOCX_PACKAGE = AVS_FILE_DOCUMENT + 0x0014,
  AVS_FILE_DOCUMENT_OFORM = AVS_FILE_DOCUMENT + 0x0015,
  AVS_FILE_DOCUMENT_DOCXF = AVS_FILE_DOCUMENT + 0x0016,
  AVS_FILE_DOCUMENT_OFORM_PDF = AVS_FILE_DOCUMENT + 0x0017,

  // Presentation
  AVS_FILE_PRESENTATION = 0x0080,
  AVS_FILE_PRESENTATION_PPTX = AVS_FILE_PRESENTATION + 0x0001,
  AVS_FILE_PRESENTATION_PPT = AVS_FILE_PRESENTATION + 0x0002,
  AVS_FILE_PRESENTATION_ODP = AVS_FILE_PRESENTATION + 0x0003,
  AVS_FILE_PRESENTATION_PPSX = AVS_FILE_PRESENTATION + 0x0004,
  AVS_FILE_PRESENTATION_PPTM = AVS_FILE_PRESENTATION + 0x0005,
  AVS_FILE_PRESENTATION_PPSM = AVS_FILE_PRESENTATION + 0x0006,
  AVS_FILE_PRESENTATION_POTX = AVS_FILE_PRESENTATION + 0x0007,
  AVS_FILE_PRESENTATION_POTM = AVS_FILE_PRESENTATION + 0x0008,
  AVS_FILE_PRESENTATION_ODP_FLAT = AVS_FILE_PRESENTATION + 0x0009,
  AVS_FILE_PRESENTATION_OTP = AVS_FILE_PRESENTATION + 0x000a,
  AVS_FILE_PRESENTATION_PPTX_PACKAGE = AVS_FILE_PRESENTATION + 0x000b,
  AVS_FILE_PRESENTATION_ODG = AVS_FILE_PRESENTATION + 0x000c,

  // Spreadsheet
  AVS_FILE_SPREADSHEET = 0x0100,
  AVS_FILE_SPREADSHEET_XLSX = AVS_FILE_SPREADSHEET + 0x0001,
  AVS_FILE_SPREADSHEET_XLS = AVS_FILE_SPREADSHEET + 0x0002,
  AVS_FILE_SPREADSHEET_ODS = AVS_FILE_SPREADSHEET + 0x0003,
  AVS_FILE_SPREADSHEET_CSV = AVS_FILE_SPREADSHEET + 0x0004,
  AVS_FILE_SPREADSHEET_XLSM = AVS_FILE_SPREADSHEET + 0x0005,
  AVS_FILE_SPREADSHEET_XLTX = AVS_FILE_SPREADSHEET + 0x0006,
  AVS_FILE_SPREADSHEET_XLTM = AVS_FILE_SPREADSHEET + 0x0007,
  AVS_FILE_SPREADSHEET_XLSB = AVS_FILE_SPREADSHEET + 0x0008,
  AVS_FILE_SPREADSHEET_ODS_FLAT = AVS_FILE_SPREADSHEET + 0x0009,
  AVS_FILE_SPREADSHEET_OTS = AVS_FILE_SPREADSHEET + 0x000a,
  AVS_FILE_SPREADSHEET_XLSX_FLAT = AVS_FILE_SPREADSHEET + 0x000b,
  AVS_FILE_SPREADSHEET_XLSX_PACKAGE = AVS_FILE_SPREADSHEET + 0x000c,

  // Crossplatform
  AVS_FILE_CROSSPLATFORM = 0x0200,
  AVS_FILE_CROSSPLATFORM_PDF = AVS_FILE_CROSSPLATFORM + 0x0001,
  AVS_FILE_CROSSPLATFORM_SWF = AVS_FILE_CROSSPLATFORM + 0x0002,
  AVS_FILE_CROSSPLATFORM_DJVU = AVS_FILE_CROSSPLATFORM + 0x0003,
  AVS_FILE_CROSSPLATFORM_XPS = AVS_FILE_CROSSPLATFORM + 0x0004,
  AVS_FILE_CROSSPLATFORM_SVG = AVS_FILE_CROSSPLATFORM + 0x0005,
  AVS_FILE_CROSSPLATFORM_HTMLR = AVS_FILE_CROSSPLATFORM + 0x0006,
  AVS_FILE_CROSSPLATFORM_HTMLR_MENU = AVS_FILE_CROSSPLATFORM + 0x0007,
  AVS_FILE_CROSSPLATFORM_HTMLR_CANVAS = AVS_FILE_CROSSPLATFORM + 0x0008,
  AVS_FILE_CROSSPLATFORM_PDFA = AVS_FILE_CROSSPLATFORM + 0x0009,

  // Image
  AVS_FILE_IMAGE = 0x0400,
  AVS_FILE_IMAGE_JPG = AVS_FILE_IMAGE + 0x0001,
  AVS_FILE_IMAGE_TIFF = AVS_FILE_IMAGE + 0x0002,
  AVS_FILE_IMAGE_TGA = AVS_FILE_IMAGE + 0x0003,
  AVS_FILE_IMAGE_GIF = AVS_FILE_IMAGE + 0x0004,
  AVS_FILE_IMAGE_PNG = AVS_FILE_IMAGE + 0x0005,
  AVS_FILE_IMAGE_EMF = AVS_FILE_IMAGE + 0x0006,
  AVS_FILE_IMAGE_WMF = AVS_FILE_IMAGE + 0x0007,
  AVS_FILE_IMAGE_BMP = AVS_FILE_IMAGE + 0x0008,
  AVS_FILE_IMAGE_CR2 = AVS_FILE_IMAGE + 0x0009,
  AVS_FILE_IMAGE_PCX = AVS_FILE_IMAGE + 0x000a,
  AVS_FILE_IMAGE_RAS = AVS_FILE_IMAGE + 0x000b,
  AVS_FILE_IMAGE_PSD = AVS_FILE_IMAGE + 0x000c,
  AVS_FILE_IMAGE_ICO = AVS_FILE_IMAGE + 0x000d,

  // Other
  AVS_FILE_OTHER = 0x0800,
  AVS_FILE_OTHER_EXTRACT_IMAGE = AVS_FILE_OTHER + 0x0001,
  AVS_FILE_OTHER_MS_OFFCRYPTO = AVS_FILE_OTHER + 0x0002,
  AVS_FILE_OTHER_HTMLZIP = AVS_FILE_OTHER + 0x0003,
  AVS_FILE_OTHER_OLD_DOCUMENT = AVS_FILE_OTHER + 0x0004,
  AVS_FILE_OTHER_OLD_PRESENTATION = AVS_FILE_OTHER + 0x0005,
  AVS_FILE_OTHER_OLD_DRAWING = AVS_FILE_OTHER + 0x0006,
  AVS_FILE_OTHER_OOXML = AVS_FILE_OTHER + 0x0007,
  AVS_FILE_OTHER_JSON = AVS_FILE_OTHER + 0x0008, // 对于 mail-merge
  AVS_FILE_OTHER_ODF = AVS_FILE_OTHER + 0x000a,
  AVS_FILE_OTHER_MS_MITCRYPTO = AVS_FILE_OTHER + 0x000b,
  AVS_FILE_OTHER_MS_VBAPROJECT = AVS_FILE_OTHER + 0x000c,
  AVS_FILE_OTHER_PACKAGE_IN_OLE = AVS_FILE_OTHER + 0x000d,

  // Teamlab
  AVS_FILE_TEAMLAB = 0x1000,
  AVS_FILE_TEAMLAB_DOCY = AVS_FILE_TEAMLAB + 0x0001,
  AVS_FILE_TEAMLAB_XLSY = AVS_FILE_TEAMLAB + 0x0002,
  AVS_FILE_TEAMLAB_PPTY = AVS_FILE_TEAMLAB + 0x0003,

  // Canvas
  AVS_FILE_CANVAS = 0x2000,
  AVS_FILE_CANVAS_WORD = AVS_FILE_CANVAS + 0x0001,
  AVS_FILE_CANVAS_SPREADSHEET = AVS_FILE_CANVAS + 0x0002,
  AVS_FILE_CANVAS_PRESENTATION = AVS_FILE_CANVAS + 0x0003,
  AVS_FILE_CANVAS_PDF = AVS_FILE_CANVAS + 0x0004,

  // Draw
  AVS_FILE_DRAW = 0x4000,
  AVS_FILE_DRAW_VSDX = AVS_FILE_DRAW + 0x0001,
  AVS_FILE_DRAW_VSSX = AVS_FILE_DRAW + 0x0002,
  AVS_FILE_DRAW_VSTX = AVS_FILE_DRAW + 0x0003,
  AVS_FILE_DRAW_VSDM = AVS_FILE_DRAW + 0x0004,
  AVS_FILE_DRAW_VSSM = AVS_FILE_DRAW + 0x0005,
  AVS_FILE_DRAW_VSTM = AVS_FILE_DRAW + 0x0006,
}

export function getFileExtensionByType(type: number | AvsFileType): string {
  switch (type) {
    case AvsFileType.AVS_FILE_DOCUMENT_DOCX:
    case AvsFileType.AVS_FILE_DOCUMENT_DOCX_FLAT:
    case AvsFileType.AVS_FILE_DOCUMENT_DOCX_PACKAGE:
      return "docx";
    case AvsFileType.AVS_FILE_DOCUMENT_DOC:
    case AvsFileType.AVS_FILE_DOCUMENT_DOC_FLAT:
      return "doc";
    case AvsFileType.AVS_FILE_DOCUMENT_ODT:
    case AvsFileType.AVS_FILE_DOCUMENT_ODT_FLAT:
      return "odt";
    case AvsFileType.AVS_FILE_DOCUMENT_RTF:
      return "rtf";
    case AvsFileType.AVS_FILE_DOCUMENT_TXT:
      return "txt";
    case AvsFileType.AVS_FILE_DOCUMENT_HTML:
    case AvsFileType.AVS_FILE_DOCUMENT_HTML_IN_CONTAINER:
      return "html";
    case AvsFileType.AVS_FILE_DOCUMENT_MHT:
      return "mht";
    case AvsFileType.AVS_FILE_DOCUMENT_EPUB:
      return "epub";
    case AvsFileType.AVS_FILE_DOCUMENT_FB2:
      return "fb2";
    case AvsFileType.AVS_FILE_DOCUMENT_MOBI:
      return "mobi";
    case AvsFileType.AVS_FILE_DOCUMENT_DOCM:
      return "docm";
    case AvsFileType.AVS_FILE_DOCUMENT_DOTX:
      return "dotx";
    case AvsFileType.AVS_FILE_DOCUMENT_DOTM:
      return "dotm";
    case AvsFileType.AVS_FILE_DOCUMENT_OTT:
      return "ott";
    case AvsFileType.AVS_FILE_DOCUMENT_OFORM:
      return "oform";
    case AvsFileType.AVS_FILE_DOCUMENT_DOCXF:
      return "docxf";
    case AvsFileType.AVS_FILE_DOCUMENT_OFORM_PDF:
      return "pdf";

    case AvsFileType.AVS_FILE_PRESENTATION_PPTX:
    case AvsFileType.AVS_FILE_PRESENTATION_PPTX_PACKAGE:
      return "pptx";
    case AvsFileType.AVS_FILE_PRESENTATION_PPT:
      return "ppt";
    case AvsFileType.AVS_FILE_PRESENTATION_ODP:
    case AvsFileType.AVS_FILE_PRESENTATION_ODP_FLAT:
      return "odp";
    case AvsFileType.AVS_FILE_PRESENTATION_PPSX:
      return "ppsx";
    case AvsFileType.AVS_FILE_PRESENTATION_PPTM:
      return "pptm";
    case AvsFileType.AVS_FILE_PRESENTATION_PPSM:
      return "ppsm";
    case AvsFileType.AVS_FILE_PRESENTATION_POTX:
      return "potx";
    case AvsFileType.AVS_FILE_PRESENTATION_POTM:
      return "potm";
    case AvsFileType.AVS_FILE_PRESENTATION_OTP:
      return "otp";
    case AvsFileType.AVS_FILE_PRESENTATION_ODG:
      return "odg";

    case AvsFileType.AVS_FILE_SPREADSHEET_XLSX:
    case AvsFileType.AVS_FILE_SPREADSHEET_XLSX_FLAT:
    case AvsFileType.AVS_FILE_SPREADSHEET_XLSX_PACKAGE:
      return "xlsx";
    case AvsFileType.AVS_FILE_SPREADSHEET_XLS:
      return "xls";
    case AvsFileType.AVS_FILE_SPREADSHEET_ODS:
    case AvsFileType.AVS_FILE_SPREADSHEET_ODS_FLAT:
      return "ods";
    case AvsFileType.AVS_FILE_SPREADSHEET_CSV:
      return "csv";
    case AvsFileType.AVS_FILE_SPREADSHEET_XLSM:
      return "xlsm";
    case AvsFileType.AVS_FILE_SPREADSHEET_XLTX:
      return "xltx";
    case AvsFileType.AVS_FILE_SPREADSHEET_XLTM:
      return "xltm";
    case AvsFileType.AVS_FILE_SPREADSHEET_XLSB:
      return "xlsb";
    case AvsFileType.AVS_FILE_SPREADSHEET_OTS:
      return "ots";

    case AvsFileType.AVS_FILE_CROSSPLATFORM_PDF:
    case AvsFileType.AVS_FILE_CROSSPLATFORM_PDFA:
      return "pdf";
    case AvsFileType.AVS_FILE_CROSSPLATFORM_SWF:
      return "swf";
    case AvsFileType.AVS_FILE_CROSSPLATFORM_DJVU:
      return "djvu";
    case AvsFileType.AVS_FILE_CROSSPLATFORM_XPS:
      return "xps";
    case AvsFileType.AVS_FILE_CROSSPLATFORM_SVG:
      return "svg";
    case AvsFileType.AVS_FILE_CROSSPLATFORM_HTMLR:
    case AvsFileType.AVS_FILE_CROSSPLATFORM_HTMLR_MENU:
    case AvsFileType.AVS_FILE_CROSSPLATFORM_HTMLR_CANVAS:
      return "html";

    case AvsFileType.AVS_FILE_IMAGE_JPG:
      return "jpg";
    case AvsFileType.AVS_FILE_IMAGE_TIFF:
      return "tiff";
    case AvsFileType.AVS_FILE_IMAGE_TGA:
      return "tga";
    case AvsFileType.AVS_FILE_IMAGE_GIF:
      return "gif";
    case AvsFileType.AVS_FILE_IMAGE_PNG:
      return "png";
    case AvsFileType.AVS_FILE_IMAGE_EMF:
      return "emf";
    case AvsFileType.AVS_FILE_IMAGE_WMF:
      return "wmf";
    case AvsFileType.AVS_FILE_IMAGE_BMP:
      return "bmp";
    case AvsFileType.AVS_FILE_IMAGE_CR2:
      return "cr2";
    case AvsFileType.AVS_FILE_IMAGE_PCX:
      return "pcx";
    case AvsFileType.AVS_FILE_IMAGE_RAS:
      return "ras";
    case AvsFileType.AVS_FILE_IMAGE_PSD:
      return "psd";
    case AvsFileType.AVS_FILE_IMAGE_ICO:
      return "ico";

    case AvsFileType.AVS_FILE_OTHER_JSON:
      return "json";

    case AvsFileType.AVS_FILE_TEAMLAB_DOCY:
      return "docy";
    case AvsFileType.AVS_FILE_TEAMLAB_XLSY:
      return "xlsy";
    case AvsFileType.AVS_FILE_TEAMLAB_PPTY:
      return "ppty";

    case AvsFileType.AVS_FILE_CANVAS_WORD:
      return "docx";
    case AvsFileType.AVS_FILE_CANVAS_SPREADSHEET:
      return "xlsx";
    case AvsFileType.AVS_FILE_CANVAS_PRESENTATION:
      return "pptx";
    case AvsFileType.AVS_FILE_CANVAS_PDF:
      return "pdf";

    case AvsFileType.AVS_FILE_DRAW_VSDX:
      return "vsdx";
    case AvsFileType.AVS_FILE_DRAW_VSSX:
      return "vssx";
    case AvsFileType.AVS_FILE_DRAW_VSTX:
      return "vstx";
    case AvsFileType.AVS_FILE_DRAW_VSDM:
      return "vsdm";
    case AvsFileType.AVS_FILE_DRAW_VSSM:
      return "vssm";
    case AvsFileType.AVS_FILE_DRAW_VSTM:
      return "vstm";

    default:
      return "";
  }
}

export function getAvsFileTypeByExtension(extension: string): AvsFileType {
  const normalized = extension.toLowerCase().replace(/^\./, "");
  switch (normalized) {
    case "docx":
      return AvsFileType.AVS_FILE_DOCUMENT_DOCX;
    case "doc":
      return AvsFileType.AVS_FILE_DOCUMENT_DOC;
    case "odt":
      return AvsFileType.AVS_FILE_DOCUMENT_ODT;
    case "rtf":
      return AvsFileType.AVS_FILE_DOCUMENT_RTF;
    case "txt":
      return AvsFileType.AVS_FILE_DOCUMENT_TXT;
    case "html":
      return AvsFileType.AVS_FILE_DOCUMENT_HTML;
    case "mht":
      return AvsFileType.AVS_FILE_DOCUMENT_MHT;
    case "epub":
      return AvsFileType.AVS_FILE_DOCUMENT_EPUB;
    case "fb2":
      return AvsFileType.AVS_FILE_DOCUMENT_FB2;
    case "mobi":
      return AvsFileType.AVS_FILE_DOCUMENT_MOBI;
    case "docm":
      return AvsFileType.AVS_FILE_DOCUMENT_DOCM;
    case "dotx":
      return AvsFileType.AVS_FILE_DOCUMENT_DOTX;
    case "dotm":
      return AvsFileType.AVS_FILE_DOCUMENT_DOTM;
    case "ott":
      return AvsFileType.AVS_FILE_DOCUMENT_OTT;
    case "oform":
      return AvsFileType.AVS_FILE_DOCUMENT_OFORM;
    case "docxf":
      return AvsFileType.AVS_FILE_DOCUMENT_DOCXF;

    case "pptx":
      return AvsFileType.AVS_FILE_PRESENTATION_PPTX;
    case "ppt":
      return AvsFileType.AVS_FILE_PRESENTATION_PPT;
    case "odp":
      return AvsFileType.AVS_FILE_PRESENTATION_ODP;
    case "ppsx":
      return AvsFileType.AVS_FILE_PRESENTATION_PPSX;
    case "pptm":
      return AvsFileType.AVS_FILE_PRESENTATION_PPTM;
    case "ppsm":
      return AvsFileType.AVS_FILE_PRESENTATION_PPSM;
    case "potx":
      return AvsFileType.AVS_FILE_PRESENTATION_POTX;
    case "potm":
      return AvsFileType.AVS_FILE_PRESENTATION_POTM;
    case "otp":
      return AvsFileType.AVS_FILE_PRESENTATION_OTP;
    case "odg":
      return AvsFileType.AVS_FILE_PRESENTATION_ODG;

    case "xlsx":
      return AvsFileType.AVS_FILE_SPREADSHEET_XLSX;
    case "xls":
      return AvsFileType.AVS_FILE_SPREADSHEET_XLS;
    case "ods":
      return AvsFileType.AVS_FILE_SPREADSHEET_ODS;
    case "csv":
      return AvsFileType.AVS_FILE_SPREADSHEET_CSV;
    case "xlsm":
      return AvsFileType.AVS_FILE_SPREADSHEET_XLSM;
    case "xltx":
      return AvsFileType.AVS_FILE_SPREADSHEET_XLTX;
    case "xltm":
      return AvsFileType.AVS_FILE_SPREADSHEET_XLTM;
    case "xlsb":
      return AvsFileType.AVS_FILE_SPREADSHEET_XLSB;
    case "ots":
      return AvsFileType.AVS_FILE_SPREADSHEET_OTS;

    case "pdf":
      return AvsFileType.AVS_FILE_CROSSPLATFORM_PDF;
    case "swf":
      return AvsFileType.AVS_FILE_CROSSPLATFORM_SWF;
    case "djvu":
      return AvsFileType.AVS_FILE_CROSSPLATFORM_DJVU;
    case "xps":
      return AvsFileType.AVS_FILE_CROSSPLATFORM_XPS;
    case "svg":
      return AvsFileType.AVS_FILE_CROSSPLATFORM_SVG;

    case "jpg":
    case "jpeg":
      return AvsFileType.AVS_FILE_IMAGE_JPG;
    case "tiff":
      return AvsFileType.AVS_FILE_IMAGE_TIFF;
    case "tga":
      return AvsFileType.AVS_FILE_IMAGE_TGA;
    case "gif":
      return AvsFileType.AVS_FILE_IMAGE_GIF;
    case "png":
      return AvsFileType.AVS_FILE_IMAGE_PNG;
    case "emf":
      return AvsFileType.AVS_FILE_IMAGE_EMF;
    case "wmf":
      return AvsFileType.AVS_FILE_IMAGE_WMF;
    case "bmp":
      return AvsFileType.AVS_FILE_IMAGE_BMP;
    case "cr2":
      return AvsFileType.AVS_FILE_IMAGE_CR2;
    case "pcx":
      return AvsFileType.AVS_FILE_IMAGE_PCX;
    case "ras":
      return AvsFileType.AVS_FILE_IMAGE_RAS;
    case "psd":
      return AvsFileType.AVS_FILE_IMAGE_PSD;
    case "ico":
      return AvsFileType.AVS_FILE_IMAGE_ICO;

    case "json":
      return AvsFileType.AVS_FILE_OTHER_JSON;

    case "docy":
      return AvsFileType.AVS_FILE_TEAMLAB_DOCY;
    case "xlsy":
      return AvsFileType.AVS_FILE_TEAMLAB_XLSY;
    case "ppty":
      return AvsFileType.AVS_FILE_TEAMLAB_PPTY;

    case "vsdx":
      return AvsFileType.AVS_FILE_DRAW_VSDX;
    case "vssx":
      return AvsFileType.AVS_FILE_DRAW_VSSX;
    case "vstx":
      return AvsFileType.AVS_FILE_DRAW_VSTX;
    case "vsdm":
      return AvsFileType.AVS_FILE_DRAW_VSDM;
    case "vssm":
      return AvsFileType.AVS_FILE_DRAW_VSSM;
    case "vstm":
      return AvsFileType.AVS_FILE_DRAW_VSTM;

    default:
      return AvsFileType.AVS_FILE_UNKNOWN;
  }
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
