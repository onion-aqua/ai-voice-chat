<script setup>
import { reactive, watch } from 'vue'

const props = defineProps({
  open: Boolean,
  chat: { type: Object, required: true },
  image: { type: Object, required: true },
  forceWebConfig: Boolean,
  dark: Boolean,
})
const emit = defineEmits(['close', 'save'])
const localChat = reactive({})
const localImage = reactive({})
const local = reactive({ force: false })

function sync() {
  Object.assign(localChat, props.chat)
  Object.assign(localImage, props.image)
  local.force = props.forceWebConfig
}
watch(() => props.open, (open) => { if (open) sync() }, { immediate: true })
function save() { emit('save', { chat: { ...localChat }, image: { ...localImage }, force: local.force }); emit('close') }
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="modal-backdrop" @mousedown.self="emit('close')">
      <section class="settings-modal" :class="{ dark }" role="dialog" aria-modal="true" aria-label="模型设置">
        <header><div><span>连接设置</span><h2>模型与 API</h2></div><button type="button" @click="emit('close')">×</button></header>
        <div class="modal-body">
          <label class="switch-row"><input v-model="local.force" type="checkbox" /><span>强制使用网页配置</span><small>关闭时优先读取 config.txt；配置缺失才使用本页。</small></label>
          <div class="form-grid">
            <label>服务提供方<select v-model="localChat.provider"><option value="openai_compatible">OpenAI 兼容</option><option value="lm_studio">LM Studio</option></select></label>
            <label>模型名称<input v-model.trim="localChat.model" placeholder="例如 gpt-5.6" /></label>
            <label class="wide">Base URL<input v-model.trim="localChat.base_url" placeholder="http://127.0.0.1:1234/v1" /></label>
            <label class="wide">API Key<input v-model="localChat.api_key" type="password" placeholder="本地服务可留空" autocomplete="off" /></label>
          </div>
          <div class="section-title">图片生成（由智能体按需调用）</div>
          <div class="form-grid">
            <label>API 模式<select v-model="localImage.api_mode"><option value="images">Images API</option><option value="responses">Responses API</option></select></label>
            <label>图片模型<input v-model.trim="localImage.model" placeholder="图片模型名称" /></label>
            <label class="wide">图片 API Base URL<input v-model.trim="localImage.base_url" placeholder="留空时复用聊天 Base URL" /></label>
            <label class="wide">图片 API Key<input v-model="localImage.api_key" type="password" placeholder="留空时复用聊天 API Key" autocomplete="off" /></label>
          </div>
        </div>
        <footer><button class="secondary" type="button" @click="emit('close')">取消</button><button class="primary" type="button" @click="save">保存设置</button></footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.modal-backdrop { position:fixed; inset:0; z-index:100; display:grid; place-items:center; padding:18px; background:rgba(16,30,23,.14); backdrop-filter:blur(2px); }.settings-modal { --page:#f7f8f1; --surface:#fbfcf8; --surface-soft:#eff3ea; --line:#dce3d6; --text:#213a34; --muted:#73817b; --brand:#2e7a65; --brand-soft:#dfeee6; width:min(680px,100%); max-height:min(86dvh,760px); display:flex; flex-direction:column; overflow:hidden; border:1px solid var(--line); border-radius:18px; color:var(--text); background:var(--surface); box-shadow:0 24px 80px rgba(0,0,0,.22); }.settings-modal.dark { --page:#121816; --surface:#19221e; --surface-soft:#233029; --line:#34463d; --text:#ebf3ee; --muted:#a6b4ab; --brand:#69ba95; --brand-soft:#1c3d2e; }.settings-modal header,.settings-modal footer { display:flex; align-items:center; justify-content:space-between; padding:18px 22px; border-bottom:1px solid var(--line); }.settings-modal header span { color:var(--muted); font-size:12px; }.settings-modal h2 { margin:3px 0 0; font-size:20px; }.settings-modal header button { border:0; color:var(--muted); background:transparent; font-size:28px; }.modal-body { overflow:auto; padding:20px 22px; }.switch-row { display:grid; grid-template-columns:auto 1fr; column-gap:10px; align-items:center; margin-bottom:20px; padding:13px; border-radius:11px; background:var(--surface-soft); }.switch-row input { width:18px; height:18px; accent-color:var(--brand); }.switch-row small { grid-column:2; margin-top:3px; color:var(--muted); font-size:11px; }.form-grid { display:grid; grid-template-columns:1fr 1fr; gap:13px; }.form-grid label { display:grid; gap:6px; color:var(--muted); font-size:12px; }.form-grid .wide { grid-column:1 / -1; }.form-grid input,.form-grid select { width:100%; min-height:39px; border:1px solid var(--line); border-radius:8px; padding:0 10px; color:var(--text); background:var(--surface); }.section-title { margin:24px 0 12px; color:var(--brand); font-weight:700; }.settings-modal footer { justify-content:flex-end; gap:9px; border-top:1px solid var(--line); border-bottom:0; }.settings-modal footer button { min-height:38px; border-radius:8px; padding:0 15px; }.secondary { border:1px solid var(--line); color:var(--text); background:var(--surface); }.primary { border:1px solid var(--brand); color:white; background:var(--brand); }@media(max-width:520px){.modal-backdrop{padding:0;align-items:end}.settings-modal{max-height:92dvh;border-radius:18px 18px 0 0}.form-grid{grid-template-columns:1fr}.form-grid .wide{grid-column:auto}.settings-modal header,.settings-modal footer,.modal-body{padding-right:16px;padding-left:16px}}
</style>
