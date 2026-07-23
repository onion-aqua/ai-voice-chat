<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { requestJson } from '../lib/api'

const props = defineProps({
  speaking: Boolean,
  emotion: { type: Array, default: () => [] },
  live2dControl: { type: Object, default: null },
})
const emit = defineEmits(['model-change'])
const host = ref(null)
const models = ref([])
const modelId = ref('')
const state = ref('正在载入 Live2D…')
let pixiApp
let liveModel
let wheelHandler
let pointerDownHandler
let pointerMoveHandler
let pointerUpHandler
let drag = null
let pluginRegistered = false
let resizeObserver = null
let naturalSize = { width: 1, height: 1 }
let expressionNames = []
let manualMotions = []
let lastExpression = ''
let lastMotion = ''
let lastMotionAt = 0

const selected = computed(() => models.value.find((item) => item.id === modelId.value))

function setMouth(openAmount = 0) {
  const core = liveModel?.internalModel?.coreModel
  if (!core?.setParameterValueById) return
  try { core.setParameterValueById('ParamMouthOpenY', Math.max(0, Math.min(1, openAmount))) } catch { /* Some models use a custom mouth parameter. */ }
}

function emotionExpression() {
  if (!expressionNames.length) return ''
  const values = Array.isArray(props.emotion) ? props.emotion : []
  let strongest = 0
  for (let index = 1; index < 7; index += 1) {
    if (Number(values[index] || 0) > Number(values[strongest] || 0)) strongest = index
  }
  return expressionNames[strongest % expressionNames.length]
}

function applyLive2DInstruction() {
  if (!liveModel || !props.speaking) return
  const requestedExpression = typeof props.live2dControl?.expression === 'string' ? props.live2dControl.expression : ''
  const expression = expressionNames.includes(requestedExpression) ? requestedExpression : emotionExpression()
  if (expression && expression !== lastExpression) {
    lastExpression = expression
    try { Promise.resolve(liveModel.expression(expression)).catch((error) => console.warn('Live2D expression failed.', error)) } catch (error) { console.warn('Live2D expression failed.', error) }
  }

  const requestedMotion = typeof props.live2dControl?.motion === 'string' ? props.live2dControl.motion : ''
  const motionIndex = manualMotions.indexOf(requestedMotion)
  if (motionIndex >= 0 && (requestedMotion !== lastMotion || performance.now() - lastMotionAt > 650)) {
    lastMotion = requestedMotion
    lastMotionAt = performance.now()
    try { Promise.resolve(liveModel.motion('Manual', motionIndex)).catch((error) => console.warn('Live2D motion failed.', error)) } catch (error) { console.warn('Live2D motion failed.', error) }
  }

  if (requestedExpression || requestedMotion) {
    const labels = []
    if (expression) labels.push(`表情：${expression}`)
    if (requestedMotion) labels.push(`动作：${requestedMotion}`)
    state.value = labels.join(' · ')
  } else {
    state.value = '朗读同步中'
  }
}

function updateSpeakingState() {
  if (!liveModel) return
  if (!props.speaking) {
    setMouth(0)
    state.value = '待机'
    return
  }
  setMouth(.62)
  applyLive2DInstruction()
}

function waitForLive2D() {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const tick = () => {
      if (window.PIXI?.live2d?.Live2DModel) return resolve()
      if (Date.now() - started > 10000) return reject(new Error('Live2D 脚本未能加载'))
      window.setTimeout(tick, 150)
    }
    tick()
  })
}

async function destroyModel() {
  resizeObserver?.disconnect()
  resizeObserver = null
  if (liveModel) { liveModel.destroy?.({ children: true }); liveModel = null }
  if (pixiApp) { await pixiApp.destroy?.(true, { children: true }); pixiApp = null }
  if (host.value) host.value.innerHTML = ''
}

function fitModel() {
  if (!liveModel || !pixiApp) return
  const width = pixiApp.renderer.width
  const height = pixiApp.renderer.height
  const ratio = Math.min((width * .78) / Math.max(naturalSize.width, 1), (height * .83) / Math.max(naturalSize.height, 1))
  liveModel.scale.set(Math.max(.05, ratio))
  liveModel.x = width / 2
  liveModel.y = height * .95
}

function bindCanvas(canvas) {
  wheelHandler = (event) => {
    event.preventDefault()
    if (!liveModel) return
    const next = Math.max(.04, Math.min(3.5, liveModel.scale.x * (event.deltaY < 0 ? 1.1 : .9)))
    liveModel.scale.set(next)
  }
  pointerDownHandler = (event) => {
    if (!liveModel) return
    drag = { x: event.clientX, y: event.clientY, modelX: liveModel.x, modelY: liveModel.y }
    canvas.setPointerCapture?.(event.pointerId)
  }
  pointerMoveHandler = (event) => {
    if (!drag || !liveModel) return
    liveModel.x = drag.modelX + event.clientX - drag.x
    liveModel.y = drag.modelY + event.clientY - drag.y
  }
  pointerUpHandler = () => { drag = null }
  canvas.addEventListener('wheel', wheelHandler, { passive: false })
  canvas.addEventListener('pointerdown', pointerDownHandler)
  canvas.addEventListener('pointermove', pointerMoveHandler)
  canvas.addEventListener('pointerup', pointerUpHandler)
  canvas.addEventListener('pointercancel', pointerUpHandler)
}

async function loadModel() {
  if (!selected.value || !host.value) return
  state.value = '正在加载模型…'
  try {
    await waitForLive2D()
    await destroyModel()
    await nextTick()
    const Live2DModel = window.PIXI.live2d.Live2DModel
    const Live2DPlugin = window.PIXI.live2d.Live2DPlugin
    if (!window.Live2DCubismCore || !Live2DPlugin) throw new Error('Live2D runtime did not finish loading.')
    if (!pluginRegistered) {
      window.PIXI.extensions.add(Live2DPlugin)
      pluginRegistered = true
    }
    window.PIXI.live2d.configureCubismSDK?.({ memorySizeMB: 32 })
    const canvas = document.createElement('canvas')
    host.value.append(canvas)
    pixiApp = new window.PIXI.Application()
    await pixiApp.init({
      canvas, autoStart: true, antialias: true, backgroundAlpha: 0, autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      width: Math.max(1, Math.floor(host.value.clientWidth)),
      height: Math.max(1, Math.floor(host.value.clientHeight)), preference: 'webgl',
    })
    liveModel = await Live2DModel.from(selected.value.url, { autoHitTest: false, autoFocus: false })
    liveModel.anchor.set(.5, 1)
    pixiApp.stage.addChild(liveModel)
    naturalSize = { width: Math.max(1, liveModel.width), height: Math.max(1, liveModel.height) }
    expressionNames = Array.isArray(selected.value.expressions) ? selected.value.expressions : []
    manualMotions = Array.isArray(selected.value.motion_groups?.Manual) ? selected.value.motion_groups.Manual : []
    lastExpression = ''
    lastMotion = ''
    fitModel()
    bindCanvas(canvas)
    resizeObserver = new ResizeObserver(() => {
      if (!pixiApp || !host.value) return
      pixiApp.renderer.resize(Math.max(1, Math.floor(host.value.clientWidth)), Math.max(1, Math.floor(host.value.clientHeight)))
      fitModel()
    })
    resizeObserver.observe(host.value)
    pixiApp.ticker.add(() => {
      if (!props.speaking) return
      setMouth(.18 + ((Math.sin(performance.now() / 55) + 1) * .28))
    })
    updateSpeakingState()
    state.value = '拖动移动 · 滚轮缩放'
    emit('model-change', selected.value.id)
  } catch (error) {
    console.warn('Unable to initialize Live2D.', error)
    state.value = 'Live2D 模型加载失败'
  }
}

async function fetchModels() {
  try {
    const data = await requestJson('/api/live2d/models')
    models.value = data.models || []
    modelId.value = data.default_model?.id || models.value[0]?.id || ''
    if (!modelId.value) { state.value = '没有找到本地 Live2D 模型'; return }
    await loadModel()
  } catch (error) { state.value = error.message }
}

watch(modelId, async (value, previous) => { if (value && previous && value !== previous) await loadModel() })
watch([() => props.speaking, () => props.emotion, () => props.live2dControl], updateSpeakingState, { deep: true })

onMounted(fetchModels)
onBeforeUnmount(async () => {
  const canvas = host.value?.querySelector('canvas')
  if (canvas) {
    canvas.removeEventListener('wheel', wheelHandler)
    canvas.removeEventListener('pointerdown', pointerDownHandler)
    canvas.removeEventListener('pointermove', pointerMoveHandler)
    canvas.removeEventListener('pointerup', pointerUpHandler)
    canvas.removeEventListener('pointercancel', pointerUpHandler)
  }
  await destroyModel()
})
</script>

<template>
  <aside class="live2d-panel">
    <div class="live2d-head"><div><div class="eyebrow">LIVE2D</div><strong>陪伴展示</strong></div><select v-if="models.length" v-model="modelId" aria-label="Live2D 模型"><option v-for="item in models" :key="item.id" :value="item.id">{{ item.name }}</option></select></div>
    <div ref="host" class="live2d-stage"></div>
    <p>{{ state }}</p>
  </aside>
</template>

<style scoped>
.live2d-panel { display:flex; min-width:0; flex-direction:column; padding:28px 16px 16px; border-left:1px solid var(--line); background:linear-gradient(135deg,var(--surface) 0%,var(--brand-soft) 180%); }.live2d-head { display:flex; align-items:center; justify-content:space-between; gap:8px; }.eyebrow { color:var(--muted); font:600 10px/1.2 ui-monospace,monospace; letter-spacing:.1em; }.live2d-head strong { display:block; margin-top:4px; font-size:16px; }.live2d-head select { max-width:130px; border:1px solid var(--line); border-radius:7px; padding:6px; color:var(--text); background:var(--surface); font-size:11px; }.live2d-stage { position:relative; min-height:420px; flex:1; overflow:hidden; border-radius:16px; touch-action:none; }.live2d-stage :deep(canvas) { display:block; width:100%; height:100%; cursor:grab; }.live2d-stage :deep(canvas):active { cursor:grabbing; }.live2d-panel > p { margin:8px 5px 0; color:var(--muted); text-align:center; font-size:11px; }
</style>
