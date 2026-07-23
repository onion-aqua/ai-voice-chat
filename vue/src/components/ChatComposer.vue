<script setup>
import { computed, ref } from 'vue'

const props = defineProps({
  busy: Boolean,
  thinking: Boolean,
  reasoningEffort: { type: String, default: 'none' },
  reasoningSpeed: { type: String, default: '1x' },
  isGpt56: Boolean,
  attachments: { type: Array, default: () => [] },
})
const emit = defineEmits(['send', 'stop', 'upload', 'remove-attachment', 'update:thinking', 'update:reasoningEffort', 'update:reasoningSpeed'])
const text = ref('')
const fileInput = ref(null)
const reasoningOpen = ref(false)
const effortOptions = [
  ['none', '不推理'], ['low', '低'], ['medium', '中'], ['high', '高'], ['xhigh', '超高'], ['max', '最大'],
]

const dots = computed(() => ({ none: 0, low: 1, medium: 2, high: 3, xhigh: 4, max: 5 }[props.reasoningEffort] || 0))
const thinkingLabel = computed(() => props.thinking ? '思考已开' : '思考')

function send() {
  const message = text.value.trim()
  if (!message || props.busy) return
  emit('send', message)
  text.value = ''
}
function keydown(event) {
  if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send() }
}
function selectEffort(value) {
  emit('update:reasoningEffort', value)
  emit('update:thinking', value !== 'none')
  reasoningOpen.value = false
}
function onFiles(event) {
  emit('upload', event.target.files)
  event.target.value = ''
}
</script>

<template>
  <section class="composer-wrap">
    <div v-if="attachments.length" class="attachment-list">
      <div v-for="item in attachments" :key="item.id || item.localId" class="attachment-chip">
        <img v-if="item.kind === 'image' && item.preview_url" :src="item.preview_url" :alt="item.name" />
        <span>{{ item.name }}</span>
        <button type="button" title="移除附件" @click="emit('remove-attachment', item.id || item.localId)">×</button>
      </div>
    </div>
    <div class="composer-row">
      <div class="thinking-anchor">
        <button class="thinking-button" :class="{ enabled: thinking }" type="button" @click="reasoningOpen = !reasoningOpen">
          <span>{{ thinkingLabel }}</span>
          <small v-if="dots" class="effort-dots">{{ '●'.repeat(dots) }}<b v-if="reasoningSpeed === '1.5x' && isGpt56">⚡</b></small>
        </button>
        <div v-if="reasoningOpen" class="reasoning-popover">
          <div class="reasoning-grid">
            <button v-for="[value, label] in effortOptions" :key="value" type="button" :class="{ selected: reasoningEffort === value }" @click="selectEffort(value)">{{ label }}</button>
          </div>
          <template v-if="isGpt56">
            <div class="speed-divider"></div>
            <div class="speed-choice"><span>推理速度</span><div><button type="button" :class="{ selected: reasoningSpeed === '1x' }" @click="emit('update:reasoningSpeed', '1x'); reasoningOpen = false">1x</button><button type="button" :class="{ selected: reasoningSpeed === '1.5x' }" @click="emit('update:reasoningSpeed', '1.5x'); reasoningOpen = false">1.5x</button></div></div>
          </template>
        </div>
      </div>
      <textarea v-model="text" rows="1" placeholder="输入你想问的问题…" :disabled="false" @keydown="keydown"></textarea>
      <input ref="fileInput" class="sr-only" type="file" multiple accept="image/*,.txt,.md,.pdf,.doc,.docx" @change="onFiles" />
      <button class="attach-button" type="button" title="上传文件或图片" @click="fileInput?.click()">附件</button>
      <button v-if="busy" class="send-button stop" type="button" @click="emit('stop')">停止 ■</button>
      <button v-else class="send-button" type="button" :disabled="!text.trim()" @click="send">发送 ↗</button>
    </div>
    <p>Enter 发送 · Shift + Enter 换行。智能体会自行决定是否搜索、读取网页、画图或查询位置。</p>
  </section>
</template>

<style scoped>
.composer-wrap { padding:12px 0 18px; background:linear-gradient(0deg,var(--page) 85%,transparent); }
.attachment-list { display:flex; gap:8px; flex-wrap:wrap; padding:0 0 8px; }
.attachment-chip { display:flex; align-items:center; gap:6px; max-width:210px; padding:5px 8px 5px 5px; border:1px solid var(--line); border-radius:9px; background:var(--surface); font-size:12px; }
.attachment-chip img { width:28px; height:28px; border-radius:5px; object-fit:cover; }.attachment-chip span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.attachment-chip button { border:0; color:var(--muted); background:transparent; }
.composer-row { position:relative; display:flex; align-items:center; gap:10px; padding:7px 8px 7px 9px; border:1px solid var(--line); border-radius:16px; background:var(--surface); box-shadow:0 8px 28px rgba(21,48,38,.05); }
.thinking-anchor { position:relative; flex:none; }.thinking-button,.attach-button,.send-button { flex:none; min-height:42px; border:1px solid var(--line); border-radius:11px; padding:0 13px; color:var(--text); background:var(--surface); white-space:nowrap; }
.thinking-button { position:relative; min-width:76px; padding-bottom:12px; }.thinking-button.enabled { border-color:var(--brand); color:var(--brand); background:var(--brand-soft); }.effort-dots { position:absolute; right:0; bottom:2px; left:0; color:currentColor; font-size:8px; letter-spacing:2px; line-height:1; }.effort-dots b { margin-left:2px; font-size:9px; letter-spacing:0; }
textarea { min-width:0; flex:1; max-height:160px; resize:vertical; border:0; outline:0; padding:9px 2px; color:var(--text); background:transparent; line-height:1.45; }
.attach-button:hover,.thinking-button:hover { border-color:var(--brand); color:var(--brand); }.send-button { border-color:var(--brand); color:white; background:var(--brand); }.send-button.stop { border-color:var(--danger); background:var(--danger); }
.composer-wrap > p { margin:8px 5px 0; color:var(--muted); font-size:11px; }
.reasoning-popover { position:absolute; bottom:calc(100% + 12px); left:0; z-index:20; display:flex; align-items:stretch; gap:16px; width:max-content; max-width:calc(100vw - 30px); padding:14px; border:1px solid var(--line); border-radius:14px; background:var(--surface); box-shadow:0 14px 35px rgba(20,45,35,.18); }
.reasoning-grid { display:grid; grid-template-columns:repeat(3, 62px); gap:7px; }.reasoning-grid button,.speed-choice button { min-height:35px; border:1px solid var(--line); border-radius:8px; color:var(--text); background:var(--surface); }.reasoning-grid button.selected,.speed-choice button.selected { border-color:var(--brand); color:var(--brand); background:var(--brand-soft); font-weight:700; }
.speed-divider { width:1px; background:var(--line); }.speed-choice { display:grid; gap:9px; min-width:112px; font-size:12px; }.speed-choice > span { color:var(--muted); }.speed-choice div { display:grid; gap:7px; }.speed-choice button { width:100%; }
@media (max-width:720px) { .composer-wrap { padding:9px 12px calc(10px + env(safe-area-inset-bottom)); }.composer-row { gap:6px; border-radius:14px; }.thinking-button,.attach-button { min-height:38px; padding:0 9px; font-size:12px; }.thinking-button { min-width:62px; }.attach-button { font-size:0; width:38px; padding:0; }.attach-button::after { content:'＋'; font-size:21px; }.send-button { min-height:38px; padding:0 10px; font-size:12px; }.reasoning-popover { left:0; padding:10px; gap:10px; }.reasoning-grid { grid-template-columns:repeat(3, 56px); gap:5px; }.speed-choice { min-width:80px; } }
</style>
