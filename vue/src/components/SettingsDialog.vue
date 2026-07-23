<script setup>
import { computed, reactive, ref, watch } from 'vue'

const props = defineProps({
  open: Boolean,
  chat: { type: Object, required: true },
  image: { type: Object, required: true },
  appearance: { type: Object, required: true },
  forceWebConfig: Boolean,
  dark: Boolean,
})

const emit = defineEmits(['close', 'save', 'preview'])
const activeTab = ref('model')
const localChat = reactive({})
const localImage = reactive({})
const localAppearance = reactive({ accent: 'jade', baseColor: 'sage', background: 'glow' })
const local = reactive({ force: false })

const accentPalettes = {
  jade: { light: ['#2e7a65', '#dfeee6'], dark: ['#69ba95', '#1c3d2e'] },
  sky: { light: ['#3478b8', '#dfebf8'], dark: ['#6eafe7', '#1d3850'] },
  violet: { light: ['#7256b1', '#ebe5f7'], dark: ['#ad92e6', '#382b56'] },
  coral: { light: ['#c66748', '#fae5dc'], dark: ['#ee9b7c', '#542f25'] },
  indigo: { light: ['#4660aa', '#e3e8f8'], dark: ['#9aacef', '#27345d'] },
  amber: { light: ['#b7791f', '#fff0cf'], dark: ['#f0bc62', '#533614'] },
  rose: { light: ['#b54d72', '#f9e1ea'], dark: ['#ec8bb1', '#532337'] },
}

const baseColorPalettes = {
  sage: { light: { page: '#f7f8f1', surface: '#fbfcf8', soft: '#eff3ea', line: '#dce3d6' }, dark: { page: '#121816', surface: '#19221e', soft: '#233029', line: '#34463d' } },
  sky: { light: { page: '#f2f7fb', surface: '#fbfdff', soft: '#e7f1f8', line: '#d7e4ee' }, dark: { page: '#121a20', surface: '#17232b', soft: '#20303a', line: '#344853' } },
  sand: { light: { page: '#fbf6ed', surface: '#fffdf9', soft: '#f6eddf', line: '#e8dccb' }, dark: { page: '#1d1915', surface: '#28231e', soft: '#352d25', line: '#4b4035' } },
  lavender: { light: { page: '#f6f3fb', surface: '#fdfbff', soft: '#eee9f7', line: '#dfd7ed' }, dark: { page: '#191720', surface: '#24202d', soft: '#312a3e', line: '#463d57' } },
  blossom: { light: { page: '#fdf3f5', surface: '#fffafb', soft: '#f8e8ed', line: '#ecd7de' }, dark: { page: '#20171a', surface: '#2c2025', soft: '#3a2a30', line: '#543b44' } },
  peach: { light: { page: '#fff5ef', surface: '#fffaf7', soft: '#f9e9de', line: '#edd7c9' }, dark: { page: '#211915', surface: '#2e211c', soft: '#3e2b23', line: '#584033' } },
  glacier: { light: { page: '#f0f8f8', surface: '#fbfefe', soft: '#e4f2f1', line: '#d2e4e3' }, dark: { page: '#142020', surface: '#1d2a2a', soft: '#283737', line: '#3d5050' } },
  graphite: { light: { page: '#f4f5f6', surface: '#fdfdfd', soft: '#eceef0', line: '#dce0e3' }, dark: { page: '#16181a', surface: '#202326', soft: '#2a2e32', line: '#3c4247' } },
}

const colorChoices = [
  { value: 'jade', label: '翡翠绿', description: '自然、沉静', preview: '#2e7a65' },
  { value: 'sky', label: '雾蓝', description: '清爽、专注', preview: '#3478b8' },
  { value: 'violet', label: '紫罗兰', description: '柔和、灵感', preview: '#7256b1' },
  { value: 'coral', label: '珊瑚橙', description: '温暖、有活力', preview: '#c66748' },
  { value: 'indigo', label: '靛蓝', description: '理性、深邃', preview: '#4660aa' },
  { value: 'amber', label: '琥珀', description: '明亮、有温度', preview: '#b7791f' },
  { value: 'rose', label: '玫瑰', description: '柔美、有张力', preview: '#b54d72' },
]

const backgroundChoices = [
  { value: 'glow', label: '柔和光晕', description: '以主题色营造轻微层次' },
  { value: 'plain', label: '纯净留白', description: '干净简洁，减少视觉干扰' },
  { value: 'mist', label: '雾感渐层', description: '更有空间感的双色背景' },
]

const baseColorChoices = [
  { value: 'sage', label: '苔原绿', description: '当前默认', preview: '#b7cfb0' },
  { value: 'sky', label: '雾蓝', description: '清透冷静', preview: '#aacfe5' },
  { value: 'sand', label: '暖砂', description: '柔和纸感', preview: '#e9c88e' },
  { value: 'lavender', label: '薰衣草', description: '安静柔和', preview: '#c7b2e4' },
  { value: 'blossom', label: '樱花粉', description: '浅淡温柔', preview: '#e9aebe' },
  { value: 'peach', label: '蜜桃', description: '温暖明快', preview: '#edae8c' },
  { value: 'glacier', label: '冰川', description: '清新通透', preview: '#9ed9d2' },
  { value: 'graphite', label: '石墨', description: '极简中性', preview: '#aeb8c0' },
]

const modalAppearanceVars = computed(() => {
  const accent = accentPalettes[localAppearance.accent] || accentPalettes.jade
  const base = (baseColorPalettes[localAppearance.baseColor] || baseColorPalettes.sage)[props.dark ? 'dark' : 'light']
  const [brand, brandSoft] = props.dark ? accent.dark : accent.light
  return {
    '--brand': brand,
    '--brand-soft': brandSoft,
    '--page': base.page,
    '--surface': base.surface,
    '--surface-soft': base.soft,
    '--line': base.line,
  }
})

function sync() {
  Object.assign(localChat, props.chat)
  Object.assign(localImage, props.image)
  Object.assign(localAppearance, props.appearance)
  local.force = props.forceWebConfig
  activeTab.value = 'model'
}

function save() {
  emit('save', {
    chat: { ...localChat },
    image: { ...localImage },
    appearance: { ...localAppearance },
    force: local.force,
  })
  emit('close')
}

function selectAppearance(key, value) {
  localAppearance[key] = value
  emit('preview', { ...localAppearance })
}

watch(() => props.open, (open) => { if (open) sync() }, { immediate: true })
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="modal-backdrop" @mousedown.self="emit('close')">
      <section class="settings-modal" :class="{ dark }" :style="modalAppearanceVars" role="dialog" aria-modal="true" aria-label="应用设置">
        <header class="settings-header">
          <div class="header-top">
            <div>
              <span>应用设置</span>
              <h2>{{ activeTab === 'model' ? '模型与 API' : '界面颜色与背景' }}</h2>
            </div>
            <button class="close-button" type="button" aria-label="关闭设置" @click="emit('close')">×</button>
          </div>

          <nav class="settings-tabs" role="tablist" aria-label="设置分类">
            <button
              class="settings-tab"
              :class="{ active: activeTab === 'model' }"
              type="button"
              role="tab"
              :aria-selected="activeTab === 'model'"
              @click="activeTab = 'model'"
            >
              <span>连接设置</span>
              <strong>模型与 API</strong>
            </button>
            <button
              class="settings-tab"
              :class="{ active: activeTab === 'appearance' }"
              type="button"
              role="tab"
              :aria-selected="activeTab === 'appearance'"
              @click="activeTab = 'appearance'"
            >
              <span>个性化</span>
              <strong>界面颜色与背景</strong>
            </button>
          </nav>
        </header>

        <div class="modal-body">
          <template v-if="activeTab === 'model'">
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
          </template>

          <section v-else class="appearance-panel" aria-label="界面颜色与背景">
            <p class="appearance-intro">选择一个主题色和背景样式。保存后会立即应用，并保留到下次打开页面。</p>

            <fieldset>
              <legend>界面主色</legend>
              <div class="choice-grid color-grid">
                <button
                  v-for="option in colorChoices"
                  :key="option.value"
                  class="choice-card color-choice"
                  :class="{ active: localAppearance.accent === option.value }"
                  :style="{ '--choice-color': option.preview }"
                  type="button"
                  @click="selectAppearance('accent', option.value)"
                >
                  <i aria-hidden="true"></i>
                  <span><strong>{{ option.label }}</strong><small>{{ option.description }}</small></span>
                </button>
              </div>
            </fieldset>

            <fieldset>
              <legend>界面底色</legend>
              <div class="choice-grid base-color-grid">
                <button
                  v-for="option in baseColorChoices"
                  :key="option.value"
                  class="choice-card base-color-choice"
                  :class="{ active: localAppearance.baseColor === option.value }"
                  :style="{ '--base-color': baseColorPalettes[option.value].light.page, '--base-preview': option.preview }"
                  type="button"
                  @click="selectAppearance('baseColor', option.value)"
                >
                  <i aria-hidden="true"></i>
                  <span><strong>{{ option.label }}</strong><small>{{ option.description }}</small></span>
                </button>
              </div>
            </fieldset>

            <fieldset>
              <legend>页面背景</legend>
              <div class="choice-grid background-grid">
                <button
                  v-for="option in backgroundChoices"
                  :key="option.value"
                  class="choice-card background-choice"
                  :class="[option.value, { active: localAppearance.background === option.value }]"
                  type="button"
                  @click="selectAppearance('background', option.value)"
                >
                  <i class="background-preview" aria-hidden="true"></i>
                  <span><strong>{{ option.label }}</strong><small>{{ option.description }}</small></span>
                </button>
              </div>
            </fieldset>

            <div class="appearance-note">深色模式会继续使用当前的明暗对比，只替换强调色与页面背景风格。</div>
          </section>
        </div>

        <footer><button class="secondary" type="button" @click="emit('close')">取消</button><button class="primary" type="button" @click="save">保存设置</button></footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.modal-backdrop { position:fixed; inset:0; z-index:100; display:grid; place-items:center; padding:18px; background:rgba(16,30,23,.14); backdrop-filter:blur(2px); }
.settings-modal { --page:#f7f8f1; --surface:#fbfcf8; --surface-soft:#eff3ea; --line:#dce3d6; --text:#213a34; --muted:#73817b; --brand:#2e7a65; --brand-soft:#dfeee6; width:min(700px,100%); max-height:min(86dvh,780px); display:flex; flex-direction:column; overflow:hidden; border:1px solid var(--line); border-radius:18px; color:var(--text); background:var(--surface); box-shadow:0 24px 80px rgba(0,0,0,.22); }
.settings-modal.dark { --page:#121816; --surface:#19221e; --surface-soft:#233029; --line:#34463d; --text:#ebf3ee; --muted:#a6b4ab; --brand:#69ba95; --brand-soft:#1c3d2e; }
.settings-header,.settings-modal footer { border-bottom:1px solid var(--line); }
.settings-header { padding:18px 22px 14px; }
.header-top { display:flex; align-items:center; justify-content:space-between; gap:16px; }
.header-top span { color:var(--muted); font-size:12px; }
.settings-modal h2 { margin:3px 0 0; font-size:20px; }
.close-button { display:grid; width:34px; height:34px; place-items:center; border:0; border-radius:9px; color:var(--muted); background:transparent; font-size:28px; line-height:1; }
.close-button:hover { color:var(--text); background:var(--surface-soft); }
.settings-tabs { display:grid; grid-template-columns:1fr 1fr; gap:9px; margin-top:16px; }
.settings-tab { display:grid; gap:2px; min-width:0; padding:10px 12px; border:1px solid var(--line); border-radius:10px; color:var(--muted); background:var(--surface); text-align:left; transition:.18s ease; }
.settings-tab span { font-size:11px; }
.settings-tab strong { overflow:hidden; color:var(--text); font-size:14px; text-overflow:ellipsis; white-space:nowrap; }
.settings-tab:hover { border-color:var(--brand); }
.settings-tab.active { border-color:var(--brand); background:var(--brand-soft); box-shadow:inset 0 0 0 1px var(--brand); }
.settings-tab.active span,.settings-tab.active strong { color:var(--brand); }
.modal-body { overflow:auto; padding:20px 22px; }
.switch-row { display:grid; grid-template-columns:auto 1fr; column-gap:10px; align-items:center; margin-bottom:20px; padding:13px; border-radius:11px; background:var(--surface-soft); }
.switch-row input { width:18px; height:18px; accent-color:var(--brand); }
.switch-row small { grid-column:2; margin-top:3px; color:var(--muted); font-size:11px; }
.form-grid { display:grid; grid-template-columns:1fr 1fr; gap:13px; }
.form-grid label { display:grid; gap:6px; color:var(--muted); font-size:12px; }
.form-grid .wide { grid-column:1 / -1; }
.form-grid input,.form-grid select { width:100%; min-height:39px; border:1px solid var(--line); border-radius:8px; padding:0 10px; color:var(--text); background:var(--surface); }
.section-title { margin:24px 0 12px; color:var(--brand); font-weight:700; }
.appearance-panel { display:grid; gap:24px; }
.appearance-intro { margin:0; color:var(--muted); font-size:13px; line-height:1.6; }
.appearance-panel fieldset { min-width:0; margin:0; padding:0; border:0; }
.appearance-panel legend { margin-bottom:10px; color:var(--text); font-weight:700; }
.choice-grid { display:grid; gap:10px; }
.color-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }
.base-color-grid { grid-template-columns:repeat(4,minmax(0,1fr)); }
.background-grid { grid-template-columns:repeat(3,minmax(0,1fr)); }
.choice-card { display:flex; min-width:0; gap:10px; padding:10px; border:1px solid var(--line); border-radius:10px; color:var(--text); background:var(--surface); text-align:left; transition:.18s ease; }
.choice-card:hover { border-color:var(--brand); transform:translateY(-1px); }
.choice-card.active { border-color:var(--brand); background:var(--brand-soft); box-shadow:inset 0 0 0 1px var(--brand); }
.choice-card > span { display:grid; min-width:0; gap:2px; }
.choice-card strong { font-size:13px; }
.choice-card small { overflow:hidden; color:var(--muted); font-size:11px; text-overflow:ellipsis; white-space:nowrap; }
.color-choice > i { display:block; flex:0 0 27px; width:27px; height:27px; border:3px solid color-mix(in srgb,var(--choice-color) 20%,white); border-radius:50%; background:var(--choice-color); }
.base-color-choice { display:grid; gap:7px; padding:8px; }
.base-color-choice.active { background:color-mix(in srgb,var(--base-preview) 18%,var(--surface)); }
.base-color-choice > i { display:block; width:100%; height:42px; border:1px solid color-mix(in srgb,var(--base-preview) 72%,#82908b); border-radius:6px; background:linear-gradient(135deg,var(--base-preview) 0 56%,var(--base-color) 56%); box-shadow:inset 0 1px rgba(255,255,255,.44); }
.background-choice { display:grid; gap:8px; }
.background-preview { display:block; width:100%; height:42px; border:1px solid var(--line); border-radius:7px; background:radial-gradient(circle at 52% 0%,var(--brand-soft),transparent 70%),var(--page); }
.background-choice.plain .background-preview { background:var(--page); }
.background-choice.mist .background-preview { background:linear-gradient(135deg,var(--brand-soft),var(--surface) 58%,color-mix(in srgb,var(--brand-soft) 60%,white)); }
.appearance-note { padding:11px 12px; border-radius:10px; color:var(--muted); background:var(--surface-soft); font-size:12px; line-height:1.55; }
.settings-modal footer { display:flex; align-items:center; justify-content:flex-end; gap:9px; padding:18px 22px; border-top:1px solid var(--line); border-bottom:0; }
.settings-modal footer button { min-height:38px; border-radius:8px; padding:0 15px; }
.secondary { border:1px solid var(--line); color:var(--text); background:var(--surface); }
.primary { border:1px solid var(--brand); color:white; background:var(--brand); }
@media(max-width:520px){
  .modal-backdrop{padding:0;align-items:end}
  .settings-modal{max-height:92dvh;border-radius:18px 18px 0 0}
  .settings-header,.settings-modal footer,.modal-body{padding-right:16px;padding-left:16px}
  .settings-tabs{gap:7px}
  .settings-tab{padding:9px 10px}
  .form-grid,.color-grid{grid-template-columns:1fr}
  .base-color-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
  .form-grid .wide{grid-column:auto}
  .background-grid{grid-template-columns:1fr}
  .background-choice{grid-template-columns:96px 1fr;align-items:center}
}
</style>
