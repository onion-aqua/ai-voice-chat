<script setup>
import { computed, ref } from 'vue'

const props = defineProps({
  conversations: { type: Array, default: () => [] },
  conversationId: { type: String, default: '' },
  voices: { type: Array, default: () => [] },
  voice: { type: String, default: '' },
  speakingSpeed: { type: Number, default: 1 },
  status: { type: Object, default: () => ({}) },
})
const emit = defineEmits(['new', 'open', 'delete', 'update:voice', 'update:speakingSpeed'])
const pendingDelete = ref('')

const statusTitle = computed(() => props.status.title || '准备就绪')
const statusDetail = computed(() => props.status.detail || '选择音色，开始一段对话。')

function askDelete(id) {
  if (pendingDelete.value === id) {
    pendingDelete.value = ''
    emit('delete', id)
  } else {
    pendingDelete.value = id
  }
}
</script>

<template>
  <aside class="sidebar desktop-sidebar">
    <div class="brand"><span class="brand-mark">S</span><span>LLM 转 TTS</span></div>
    <button class="new-chat" type="button" @click="emit('new')">＋ 新建对话</button>

    <section class="voice-card">
      <label for="voice-select">朗读音色</label>
      <select id="voice-select" :value="voice" @change="emit('update:voice', $event.target.value)">
        <option v-for="item in voices" :key="item" :value="item">{{ item }}</option>
      </select>
      <div class="speed-row"><span>朗读速度</span><strong>{{ speakingSpeed.toFixed(2) }}×</strong></div>
      <input
        aria-label="朗读速度"
        type="range" min="0.75" max="1.5" step="0.05" :value="speakingSpeed"
        @input="emit('update:speakingSpeed', Number($event.target.value))"
      />
      <p>新回答使用 IndexTTS2 自然语速；播放中可即时微调。</p>
    </section>

    <section class="history-section">
      <div class="eyebrow">CONVERSATIONS</div>
      <h2>历史对话</h2>
      <div v-if="!conversations.length" class="empty-history">还没有已保存的对话</div>
      <div class="history-list">
        <div v-for="item in conversations" :key="item.id" class="history-row">
          <button
            class="history-item" :class="{ active: item.id === conversationId }" type="button"
            :title="item.title" @click="emit('open', item.id)"
          >{{ item.title }}</button>
          <button class="history-delete" :class="{ confirm: pendingDelete === item.id }" type="button" @click="askDelete(item.id)">
            {{ pendingDelete === item.id ? '确认删除' : '删除' }}
          </button>
        </div>
      </div>
    </section>

    <div class="status-card" :class="status.kind || 'ready'">
      <span class="status-dot"></span>
      <div><strong>{{ statusTitle }}</strong><small>{{ statusDetail }}</small></div>
    </div>
    <p class="local-hint">语音合成在本机的 IndexTTS2 模型中完成。</p>
  </aside>
</template>

<style scoped>
.sidebar { display:flex; flex-direction:column; gap:14px; height:100%; min-height:0; overflow:hidden; padding:22px 18px 14px; border-right:1px solid var(--line); background:color-mix(in srgb, var(--surface) 94%, var(--page)); }
.brand { display:flex; align-items:center; gap:9px; padding:0 4px; font-family:Georgia,serif; font-size:23px; font-weight:700; letter-spacing:-.03em; white-space:nowrap; }
.brand-mark { display:grid; place-items:center; width:36px; height:36px; border-radius:11px; background:var(--brand); color:white; font:700 18px/1 Inter,sans-serif; box-shadow:0 5px 13px color-mix(in srgb, var(--brand) 24%, transparent); }
.new-chat { min-height:48px; border:1px solid var(--text); border-radius:11px; color:var(--text); background:var(--surface); font-size:14px; font-weight:650; box-shadow:0 4px 13px rgba(21,48,38,.04); }
.new-chat:hover { color:var(--brand); border-color:var(--brand); }
.voice-card { padding:13px; border:1px solid var(--line); border-radius:12px; color:var(--muted); background:var(--surface-soft); }
.voice-card label { display:block; margin-bottom:8px; font-size:13px; }
.voice-card select { width:100%; padding:11px 12px; border:1px solid var(--line); border-radius:8px; color:var(--text); background:var(--surface); }
.speed-row { display:flex; justify-content:space-between; margin-top:16px; font-size:13px; }
.speed-row strong { color:var(--brand); }
.voice-card input { width:100%; margin:12px 0 8px; accent-color:var(--brand); }
.voice-card p { margin:0; font-size:12px; line-height:1.65; }
.history-section { min-height:0; flex:1; overflow-x:hidden; overflow-y:auto; overscroll-behavior:contain; padding:7px 4px 0; border-top:1px solid var(--line); scrollbar-color:var(--line) transparent; scrollbar-gutter:stable; }
.eyebrow { color:var(--muted); font:600 11px/1.2 ui-monospace,monospace; letter-spacing:.08em; }
h2 { margin:8px 0 12px; font-size:17px; }
.history-list { display:grid; gap:3px; padding-bottom:5px; }
.history-row { display:flex; align-items:center; min-width:0; gap:3px; }
.history-item { min-width:0; flex:1; overflow:hidden; border:0; border-radius:8px; padding:9px 8px; color:var(--text); background:transparent; text-align:left; text-overflow:ellipsis; white-space:nowrap; }
.history-item:hover,.history-item.active { background:var(--surface-soft); color:var(--brand); }
.history-delete { display:none; flex:none; border:0; border-radius:6px; padding:5px 6px; color:var(--danger); background:transparent; font-size:11px; }
.history-row:hover .history-delete,.history-delete.confirm { display:block; }
.history-delete.confirm { background:color-mix(in srgb, var(--danger) 14%, transparent); }
.empty-history { padding:8px 0; color:var(--muted); font-size:13px; }
.status-card { display:flex; gap:11px; align-items:flex-start; padding:12px; border:1px solid var(--line); border-radius:11px; background:var(--surface-soft); }
.status-dot { width:9px; height:9px; margin-top:4px; border-radius:50%; background:var(--brand); }
.status-card.error .status-dot { background:var(--danger); }.status-card.working .status-dot { animation:pulse 1s infinite; }
.status-card strong,.status-card small { display:block; }.status-card strong { font-size:13px; }.status-card small { margin-top:3px; color:var(--muted); font-size:11px; line-height:1.45; }
.local-hint { margin:0; color:var(--muted); font-size:12px; line-height:1.55; }
@keyframes pulse { 50%{ opacity:.25; transform:scale(.75); } }
</style>
