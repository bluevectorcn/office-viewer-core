<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch, computed } from 'vue';
import { createEditor } from '../../application/EditorFactory';
import type { DocEditorConfig, IEditor, EditorInput, ExportFormat, LoadingStatus } from '../../shared/types/EditorTypes';

const props = defineProps<{
  config: DocEditorConfig;
  className?: string;
  style?: Record<string, string>;
}>();

const emit = defineEmits<{
  (e: 'ready', editor: IEditor): void;
}>();

const container = ref<HTMLElement | null>(null);
const editor = ref<IEditor | null>(null);
const loadingStatus = ref<LoadingStatus | null>(null);

const processedStyle = computed(() => ({
  width: '100%',
  height: '100%',
  ...props.style
}));

const initEditor = () => {
  if (editor.value) {
    editor.value.destroy();
    editor.value = null;
  }

  if (container.value) {
    try {
      // Wrap onLoadingStatus to update local state
      const augmentedConfig: DocEditorConfig = {
        ...props.config,
        events: {
          ...props.config.events,
          onLoadingStatus: (status) => {
            loadingStatus.value = status;
            props.config.events?.onLoadingStatus?.(status);
          }
        }
      };

      editor.value = createEditor(container.value, augmentedConfig);
      emit('ready', editor.value);
    } catch (e) {
      console.error('[OnlyOfficeViewer] Failed to create editor:', e);
    }
  }
};

onMounted(() => {
  initEditor();
});

onBeforeUnmount(() => {
  if (editor.value) {
    editor.value.destroy();
    editor.value = null;
  }
});

watch(() => props.config, () => {
  initEditor();
}, { deep: false });

defineExpose({
  open: async (input: EditorInput) => {
    if (!editor.value) throw new Error("Editor not initialized");
    return editor.value.open(input);
  },
  newFile: async (format: "docx" | "xlsx" | "pptx") => {
    if (!editor.value) throw new Error("Editor not initialized");
    return editor.value.newFile(format);
  },
  save: async (filename?: string) => {
    if (!editor.value) throw new Error("Editor not initialized");
    return editor.value.save(filename);
  },
  export: async (format: ExportFormat) => {
    if (!editor.value) throw new Error("Editor not initialized");
    return editor.value.export(format);
  },
  destroy: () => {
    if (editor.value) {
      editor.value.destroy();
      editor.value = null;
    }
  },
  getEditor: () => editor.value
});
</script>

<template>
  <div class="oo-viewer-wrapper" style="position: relative; width: 100%; height: 100%;">
    <div 
      ref="container" 
      :class="props.className" 
      :style="processedStyle"
    ></div>
    
    <!-- Loading Mask -->
    <div v-if="loadingStatus && loadingStatus.type !== 'ready'" class="oo-loading-mask" style="
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(255, 255, 255, 0.9);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      z-index: 100;
      font-family: sans-serif;
    ">
      <slot name="loading" :status="loadingStatus">
        <div class="oo-loading-spinner-css"></div>
        <div class="oo-loading-status" style="margin-top: 15px; color: #333; font-weight: 500;">{{ loadingStatus.message }}</div>
        <div v-if="loadingStatus.progress !== undefined" class="oo-loading-progress" style="margin-top: 10px; width: 200px; height: 4px; background: #eee; border-radius: 2px;">
          <div class="oo-loading-bar" :style="{ width: loadingStatus.progress + '%', transition: 'width 0.3s' }" style="height: 100%; background: #3498db; border-radius: 2px;"></div>
        </div>
        <div v-if="loadingStatus.type === 'error'" style="margin-top: 10px; color: #e74c3c;">{{ loadingStatus.message }}</div>
      </slot>
    </div>
  </div>
</template>
<style scoped>
  @keyframes oo-spin { 
    0% { transform: rotate(0deg); } 
    100% { transform: rotate(360deg); } 
  }
  .oo-loading-spinner-css {
    width: 40px;
    height: 40px;
    border: 4px solid #f3f3f3;
    border-top: 4px solid #3498db;
    border-radius: 50%;
    animation: oo-spin 1s linear infinite;
  }
</style>
