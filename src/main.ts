import { createEditor } from "./application/EditorFactory";
import type { DocEditorConfig } from "./shared/types/EditorTypes";
import { createBaseConfig } from "./application/config/EditorConfigBuilder";

const statusEl = document.getElementById("status");
const fileInput = document.getElementById("file-input") as HTMLInputElement | null;
const urlInput = document.getElementById("url-input") as HTMLInputElement | null;
const openDemoBtn = document.getElementById("open-demo");
const openUrlBtn = document.getElementById("open-url");
const saveBtn = document.getElementById("save");
const exportPdfBtn = document.getElementById("export-pdf");
const exportDocxBtn = document.getElementById("export-docx");
const editorHost = document.getElementById("editor");

if (!editorHost) {
  throw new Error("Editor container not found");
}

const baseConfig: DocEditorConfig = createBaseConfig({
  document: {
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
    lang: "zh",
    customization: {
      about: false,
      comments: false,
      features: {
        spellcheck: false,
      },
      // layout: {
      //   toolbar: false,
      //   leftMenu: false,
      //   rightMenu: false
      // },
    },
  },
});

const editor = createEditor(editorHost, baseConfig);

const DEMO_DOCX_BASE64 =
  "UEsDBBQAAAAIANJTOlzERlmv5gAAAKgBAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbH2Qy07DMBBF9/kKy1uUOGWBEErSBYUlsCgfMLIniYVf8ril/D2TFoqEKEvrPo7nduuDd2KPmWwMvVw1rRQYdDQ2TL183T7Wt3I9VN32IyEJ9gbq5VxKulOK9IweqIkJAytjzB4KP/OkEug3mFBdt+2N0jEUDKUuS4ccKiG6DY6wc0U8HFg5oTM6kuL+5F1wvYSUnNVQWFf7YH6B6i9Iw8mjh2ab6IoNUl2CLOJlxk/0mRfJ1qB4gVyewLNRvcdslIl65znc/N/0x2/jOFqN5/zSlnLUSMRTe9ecFQ82fF/RqePwQ/UJUEsDBBQAAAAIANJTOlzXstcdqQAAAB4BAAALAAAAX3JlbHMvLnJlbHONjzsOwjAQRPucwtqebEKBEMJJg5DSonAAy944EfFHtvndHhcUBFFQ7uzMG82+fZiZ3SjEyVkOdVkBIyudmqzmcO6Pqy20TbE/0SxStsRx8pHljI0cxpT8DjHKkYyIpfNk82dwwYiUz6DRC3kRmnBdVRsMnwxoCsYWWNYpDqFTNbD+6ekfvBuGSdLByashm360fDkyWQRNicPdBYXqLZcZC5hX4mJmU7wAUEsDBBQAAAAIANJTOlywxaswuwAAAPwAAAARAAAAd29yZC9kb2N1bWVudC54bWw1jsFuwjAMhu99Cit3msJhmqo2CIG4IQ4b4pwlLlRq7CrJKH37JYVdfn3WL392s326AR7oQ8/UinVZCUAybHu6teLyfVx9CghRk9UDE7ZixiC2qmim2rL5dUgRkoFCPbXiHuNYSxnMHZ0OJY9IqevYOx3T6G9yYm9HzwZDSAfcIDdV9SGd7kmoAiBZf9jOGZdhfNHCXqWI6kzDfO663iBcd18n2LNHOKDjRuY6p3/vy7cgw0ub6f9tVfwBUEsBAhQDFAAAAAgA0lM6XMRGWa/mAAAAqAEAABMAAAAAAAAAAAAAAIABAAAAAFtDb250ZW50X1R5cGVzXS54bWxQSwECFAMUAAAACADSUzpc17LXHakAAAAeAQAACwAAAAAAAAAAAAAAgAEXAQAAX3JlbHMvLnJlbHNQSwECFAMUAAAACADSUzpcsMWrMLsAAAD8AAAAEQAAAAAAAAAAAAAAgAHpAQAAd29yZC9kb2N1bWVudC54bWxQSwUGAAAAAAMAAwC5AAAA0wIAAAAA";

function setStatus(message: string) {
  if (statusEl) {
    statusEl.textContent = message;
  }
}

function base64ToBlob(base64: string, mime: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function openInput(input: File | Blob | ArrayBuffer | string) {
  setStatus("Opening document...");
  try {
    await editor.open(input);
    setStatus("Editor ready");
  } catch (error) {
    console.error(error);
    setStatus("Open failed");
  }
}

openDemoBtn?.addEventListener("click", async () => {
  const blob = base64ToBlob(
    DEMO_DOCX_BASE64,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );
  await openInput(blob);
});

fileInput?.addEventListener("change", async () => {
  const input = fileInput;
  if (!input) return;
  const file = input.files?.[0];
  if (file) {
    await openInput(file);
  }
  input.value = "";
});

openUrlBtn?.addEventListener("click", async () => {
  const input = urlInput;
  const url = input?.value.trim();
  if (url) {
    await openInput(url);
  }
});

saveBtn?.addEventListener("click", async () => {
  setStatus("Saving...");
  const blob = await editor.save();
  downloadBlob(blob, "onlyoffice-save.docx");
  setStatus("Saved");
});

exportPdfBtn?.addEventListener("click", async () => {
  setStatus("Exporting PDF...");
  const blob = await editor.export("pdf");
  downloadBlob(blob, "onlyoffice-export.pdf");
  setStatus("Exported PDF");
});

exportDocxBtn?.addEventListener("click", async () => {
  setStatus("Exporting Docx...");
  const blob = await editor.export("docx");
  downloadBlob(blob, "onlyoffice-export.docx");
  setStatus("Exported Docx");
});

setStatus("Idle");
