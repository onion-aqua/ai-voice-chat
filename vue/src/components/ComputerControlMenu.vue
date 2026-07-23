<script setup>
import { computed, ref } from 'vue'

const props = defineProps({ mode: { type: String, default: 'review' } })
const emit = defineEmits(['update:mode'])
const open = ref(false)

const current = computed(() => ({
  ask: '请求批准', review: '替我审批', full: '完全访问',
}[props.mode] || '替我审批'))

const options = [
  { value: 'ask', icon: '✋', title: '请求批准', description: '联网、外部文件和桌面操作都会先询问。' },
  { value: 'review', icon: '◔', title: '替我审批', description: '只让检测到风险的操作请求批准。' },
  { value: 'full', icon: '◈', title: '完全访问权限', description: '可访问互联网及电脑文件，并执行桌面操作。' },
]

function choose(value) {
  emit('update:mode', value)
  open.value = false
}
</script>

<template>
  <div class="computer-anchor">
    <button class="computer-button" :class="{ active: mode === 'full' }" type="button" :title="`电脑控制：${current}`" @click="open = !open">
      <span aria-hidden="true">⌘</span><small>{{ current }}</small>
    </button>
    <section v-if="open" class="computer-menu" aria-label="电脑控制权限">
      <header><div><strong>应如何批准电脑操作？</strong><a href="#computer-control-note" @click.prevent>了解更多</a></div><button type="button" title="关闭" @click="open = false">×</button></header>
      <button v-for="option in options" :key="option.value" class="permission-option" :class="{ selected: mode === option.value, full: option.value === 'full' }" type="button" @click="choose(option.value)">
        <span class="permission-icon" aria-hidden="true">{{ option.icon }}</span>
        <span><b>{{ option.title }}</b><small>{{ option.description }}</small></span>
        <i v-if="mode === option.value">✓</i>
      </button>
      <p id="computer-control-note">完全访问会将截图和所选文件内容发送给当前模型。不要在含有密码、支付或私人信息的屏幕上启用。</p>
    </section>
  </div>
</template>

<style scoped>
.computer-anchor { position:relative; }.computer-button { display:inline-flex; align-items:center; gap:6px; min-height:38px; border:1px solid var(--line); border-radius:12px; padding:0 10px; color:var(--text); background:var(--surface); transition:.18s ease; }.computer-button > span { color:var(--brand); font-size:21px; font-weight:700; line-height:1; }.computer-button small { max-width:78px; overflow:hidden; font-size:11px; text-overflow:ellipsis; white-space:nowrap; }.computer-button:hover,.computer-button.active { border-color:var(--brand); color:var(--brand); background:var(--brand-soft); }.computer-menu { position:absolute; z-index:50; top:calc(100% + 10px); right:0; width:min(410px,calc(100vw - 28px)); overflow:hidden; border:1px solid var(--line); border-radius:16px; padding:8px; color:var(--text); background:var(--surface); box-shadow:0 22px 56px rgba(15,30,25,.24); }.computer-menu header { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; padding:10px 10px 8px; }.computer-menu header div { display:grid; gap:5px; }.computer-menu header strong { font-size:15px; }.computer-menu header a { width:max-content; color:var(--muted); font-size:12px; text-decoration:underline; text-underline-offset:3px; }.computer-menu header button { width:26px; height:26px; border:0; border-radius:8px; color:var(--muted); background:transparent; font-size:20px; line-height:1; }.computer-menu header button:hover { color:var(--brand); background:var(--surface-soft); }.permission-option { display:grid; grid-template-columns:32px minmax(0,1fr) 22px; align-items:center; gap:10px; width:100%; border:1px solid transparent; border-radius:12px; padding:11px 10px; color:var(--text); background:transparent; text-align:left; }.permission-option:hover,.permission-option.selected { border-color:var(--line); background:var(--surface-soft); }.permission-option.full.selected { border-color:color-mix(in srgb, var(--brand) 65%, var(--line)); color:var(--brand); background:var(--brand-soft); }.permission-icon { display:grid; place-items:center; width:29px; height:29px; border-radius:9px; color:var(--muted); background:var(--surface); font-size:18px; }.permission-option.full .permission-icon { color:var(--brand); }.permission-option span:nth-child(2) { display:grid; gap:3px; }.permission-option b { font-size:14px; }.permission-option small { color:var(--muted); font-size:12px; line-height:1.35; }.permission-option i { color:var(--brand); font-style:normal; font-weight:800; text-align:center; }.computer-menu > p { margin:8px 10px 4px; color:var(--muted); font-size:11px; line-height:1.55; }
@media(max-width:720px){.computer-button{width:34px; justify-content:center; padding:0;border-radius:10px}.computer-button small{display:none}.computer-menu{right:-74px}.computer-menu header strong{font-size:14px}}
</style>
