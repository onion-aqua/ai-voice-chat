<script setup>
import { computed } from 'vue'

const props = defineProps({
  message: { type: Object, required: true },
  activeMessageId: { type: String, default: '' },
  activeLineIds: { type: Array, default: () => [] },
})
const emit = defineEmits(['replay', 'retry', 'edit'])

const isAssistant = computed(() => props.message.role === 'assistant')
const activeSet = computed(() => new Set(props.activeMessageId === props.message.id ? props.activeLineIds : []))
const lines = computed(() => props.message.lines?.length ? props.message.lines : [{ id: props.message.id, text: props.message.text || '' }])
</script>

<template>
  <article class="message" :class="message.role">
    <div class="avatar">{{ isAssistant ? '声语' : '你' }}</div>
    <div class="message-main">
      <details v-if="isAssistant && message.thinking" class="thinking-detail">
        <summary>思考过程 <span>点击展开</span></summary>
        <pre>{{ message.thinking }}</pre>
      </details>
      <details v-if="isAssistant && message.agentSteps?.length" class="agent-detail">
        <summary>▶ 智能体执行记录（{{ message.agentSteps.length }} 步，点击展开）</summary>
        <div v-for="(step, index) in message.agentSteps" :key="index" class="agent-step">{{ step }}</div>
      </details>
      <div v-if="message.status" class="message-status" role="status" aria-live="polite">{{ message.status }}</div>
      <div v-if="message.attachments?.length" class="attachment-preview">
        <template v-for="item in message.attachments" :key="item.id">
          <img v-if="item.kind === 'image' && item.preview_url" :src="item.preview_url" :alt="item.name" />
          <span v-else>{{ item.name }}</span>
        </template>
      </div>
      <div v-if="message.images?.length" class="generated-images">
        <a v-for="(image, index) in message.images" :key="index" :href="image.url || image" target="_blank" rel="noreferrer">
          <img :src="image.url || image" alt="AI 生成的图片" />
        </a>
      </div>
      <div class="bubble">
        <p v-for="line in lines" :key="line.id" :class="{ speaking: activeSet.has(line.id) }">
          <span class="stream-visible">{{ line.text }}</span>
          <span class="stream-sizer" aria-hidden="true">{{ line.fullText || line.text }}</span>
        </p>
        <span v-if="message.streaming || message.rendering" class="cursor"></span>
      </div>
      <div v-if="isAssistant && message.searchResults?.length" class="source-list">
        <a v-for="(item, index) in message.searchResults" :key="item.url || index" :href="item.url" target="_blank" rel="noreferrer">{{ item.title || item.url }}</a>
      </div>
      <div class="message-actions">
        <button v-if="isAssistant && message.text" type="button" title="朗读此回复" @click="emit('replay', message)">🔊</button>
        <template v-if="!isAssistant"><button type="button" title="重试" @click="emit('retry', message)">↻</button><button type="button" title="编辑消息" @click="emit('edit', message)">✎</button></template>
      </div>
    </div>
  </article>
</template>

<style scoped>
.message { display:flex; gap:10px; width:min(100%, 860px); margin:0 auto 20px; }.message.user { flex-direction:row-reverse; }.avatar { flex:none; display:grid; place-items:center; width:34px; height:34px; border-radius:50%; color:var(--brand); background:var(--brand-soft); font-size:12px; font-weight:700; }.user .avatar { color:white; background:var(--brand); }.message-main { position:relative; min-width:0; max-width:min(88%, 720px); }.user .message-main { display:flex; flex-direction:column; align-items:flex-end; }.bubble { border:1px solid var(--line); border-radius:5px 16px 16px 16px; padding:13px 15px; color:var(--text); background:var(--surface); line-height:1.78; white-space:pre-wrap; overflow-wrap:anywhere; }.user .bubble { border-radius:16px 5px 16px 16px; color:white; background:var(--brand); }.bubble p { display:grid; margin:0; border-radius:5px; transition:background .2s,color .2s; }.bubble p + p { margin-top:7px; }.stream-visible,.stream-sizer { grid-area:1 / 1; min-width:0; }.stream-visible { position:relative; z-index:1; }.stream-sizer { visibility:hidden; pointer-events:none; }.bubble p.speaking { margin-right:-4px; margin-left:-4px; padding:0 4px; color:var(--brand); background:var(--brand-soft); font-weight:600; }.user .bubble p.speaking { color:white; background:rgba(255,255,255,.18); }.cursor { display:inline-block; width:7px; height:1.2em; margin-left:4px; vertical-align:-.2em; background:var(--brand); animation:blink .8s infinite; }.message-actions { display:flex; gap:4px; min-height:23px; margin-top:3px; opacity:.38; }.message:hover .message-actions { opacity:1; }.message-actions button { width:25px; height:23px; border:0; border-radius:5px; color:var(--muted); background:transparent; }.message-actions button:hover { color:var(--brand); background:var(--surface-soft); }.thinking-detail,.agent-detail { margin:0 0 8px; border:1px solid var(--line); border-radius:9px; color:var(--muted); background:var(--surface-soft); font-size:13px; }.thinking-detail summary,.agent-detail summary { padding:9px 11px; cursor:pointer; color:var(--brand); font-weight:600; }.thinking-detail summary span { color:var(--muted); font-weight:400; }.thinking-detail pre { max-height:230px; overflow:auto; margin:0; padding:0 11px 11px; white-space:pre-wrap; overflow-wrap:anywhere; font:12px/1.6 ui-monospace,monospace; }.agent-step { padding:7px 11px; border-top:1px solid var(--line); }.message-status { position:absolute; z-index:4; top:0; left:8px; max-width:calc(100% - 16px); margin:0; overflow:hidden; transform:translateY(calc(-100% - 4px)); border:1px solid var(--line); border-radius:999px; padding:3px 8px; color:var(--muted); background:var(--surface); font-size:11px; line-height:1.3; text-overflow:ellipsis; white-space:nowrap; pointer-events:none; }.attachment-preview,.generated-images { display:flex; gap:8px; flex-wrap:wrap; margin:0 0 8px; }.attachment-preview img { width:140px; max-height:140px; object-fit:cover; border:1px solid var(--line); border-radius:10px; }.attachment-preview span { padding:7px 9px; border:1px solid var(--line); border-radius:7px; color:var(--muted); font-size:12px; }.generated-images img { display:block; max-width:min(100%, 400px); max-height:420px; border-radius:12px; object-fit:contain; background:var(--surface-soft); }.source-list { display:grid; gap:3px; margin-top:7px; }.source-list a { overflow:hidden; color:var(--brand); font-size:12px; text-overflow:ellipsis; white-space:nowrap; }@keyframes blink{50%{opacity:0}}
@media (max-width:720px) { .message { width:100%; margin-bottom:14px; }.avatar { width:28px; height:28px; font-size:10px; }.message-main { max-width:calc(100% - 38px); }.bubble { padding:10px 12px; line-height:1.65; font-size:14px; }.generated-images img { max-width:100%; } }
</style>
