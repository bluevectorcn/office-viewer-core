<template>
  <div 
    ref="container" 
    :class="className" 
    :style="processedStyle"
  ></div>
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch, computed } from 'vue';
import { createEditor } from '../../application/EditorFactory';
import type { DocEditorConfig, IEditor, EditorInput, ExportFormat } from '../../shared/types/EditorTypes';

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
      editor.value = createEditor(container.value, props.config);
      emit('ready', editor.value);
    } catch (e) {
      console.error('[OnlyOfficeViewer] Failed to create editor:', e);
    }
  } else {
    console.error('[OnlyOfficeViewer] Container element not found');
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

// Re-initialize only if the config object itself changes to avoid loops
watch(() => props.config, () => {
  initEditor();
}, { deep: false });

// Expose methods to parent components
defineExpose({
  open: async (input: EditorInput) => {
    if (!editor.value) throw new Error("Editor not initialized");
    return editor.value.open(input);
  },
  newFile: async (format: "docx" | "xlsx" | "pptx") => {
    if (!editor.value) throw new Error("Editor not initialized");
    return editor.value.newFile(format);
  },
  save: async () => {
    if (!editor.value) throw new Error("Editor not initialized");
    return editor.value.save();
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
