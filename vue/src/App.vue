<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import AppSidebar from './components/AppSidebar.vue'
import ChatComposer from './components/ChatComposer.vue'
import ChatMessage from './components/ChatMessage.vue'
import Live2DPanel from './components/Live2DPanel.vue'
import SettingsDialog from './components/SettingsDialog.vue'
import { createId, requestJson, shortTitle, streamSse } from './lib/api'

const messages = ref([])
const conversations = ref([])
const conversationId = ref('')
const conversationTitle = ref('新的对话')
const voices = ref([])
const voice = ref('')
const speakingSpeed = ref(1)
const muted = ref(false)
const darkMode = ref(localStorage.getItem('ai-voice-chat-vue-dark') === '1')
const settingsOpen = ref(false)
const mobileMenuOpen = ref(false)
const busy = ref(false)
const activeLineIds = ref([])
const activeMessageId = ref('')
const activeLive2DModelId = ref('')
const ttsSpeaking = ref(false)
const activeEmotion = ref([])
const activeLive2DControl = ref(null)
const status = reactive({ title: '正在连接服务', detail: '先读取 config.txt 中的默认配置。', kind: 'working' })
const chatSettings = reactive({ provider: 'openai_compatible', api_key: '', base_url: '', model: '', thinking: false, thinking_override: false, reasoning_effort: 'none', reasoning_effort_override: false, reasoning_speed: '1x', reasoning_speed_override: false, long_context_enabled: false, long_context_override: false, force_web_config: false })
const imageSettings = reactive({ api_key: '', base_url: '', model: '', api_mode: 'images', responses_model: '', force_web_config: false })
const forceWebConfig = ref(false)
const pendingAttachments = ref([])
const audioQueue = []
const textRenderQueue = []
let currentAudio = null
let currentAbortController = null
let saveTimer = null
let textRenderTimer = null

const isGpt56 = computed(() => /gpt[-_ ]?5[._-]?6/i.test(chatSettings.model || ''))
const isReady = computed(() => Boolean(voice.value))
const currentHistory = computed(() => messages.value
  .filter((item) => item.role === 'user' || (item.role === 'assistant' && item.text))
  .map((item) => ({ role: item.role, content: item.role === 'assistant' ? (item.modelContent || item.text) : item.text })))

watch(darkMode, (value) => localStorage.setItem('ai-voice-chat-vue-dark', value ? '1' : '0'))
watch(speakingSpeed, () => { if (currentAudio) currentAudio.playbackRate = speakingSpeed.value })

function setStatus(title, detail = '', kind = 'ready') {
  status.title = title
  status.detail = detail
  status.kind = kind
}

async function loadStatus() {
  try {
    const data = await requestJson('/api/status')
    voices.value = data.voices || []
    voice.value = data.default_voice || voices.value[0] || ''
    const defaults = data.chat_defaults || {}
    Object.assign(chatSettings, {
      provider: defaults.provider || 'openai_compatible',
      api_key: '',
      base_url: defaults.base_url || '',
      model: defaults.model || '',
      thinking: Boolean(defaults.thinking),
      reasoning_effort: defaults.reasoning_effort || 'none',
      reasoning_speed: defaults.reasoning_speed || '1x',
      long_context_enabled: Boolean(defaults.long_context_enabled),
    })
    const image = data.image_defaults || {}
    Object.assign(imageSettings, { api_key: '', base_url: image.base_url || '', model: image.model || '', api_mode: image.api_mode || 'images', responses_model: image.responses_model || '' })
    if (!data.configured) setStatus('需要配置模型', '请在 config.txt 填写接口，或打开右上角设置。', 'error')
    else setStatus('准备就绪', '已读取 config.txt；选择音色后即可开始对话。')
  } catch (error) {
    setStatus('服务未连接', error.message, 'error')
  }
}

async function loadConversations() {
  try {
    const data = await requestJson('/api/conversations')
    conversations.value = Array.isArray(data.conversations) ? data.conversations : []
  } catch (error) { console.warn('Unable to load conversations', error) }
}

function newConversation() {
  stopAll()
  messages.value = []
  pendingAttachments.value = []
  conversationId.value = ''
  conversationTitle.value = '新的对话'
  mobileMenuOpen.value = false
  setStatus('准备就绪', '新的对话已经开始。')
}

function restoredMessage(item) {
  const text = item.content || ''
  return {
    id: createId('message'), role: item.role, text,
    modelContent: item.model_content || (item.role === 'assistant' ? text : ''),
    lines: item.role === 'assistant' ? text.split(/\n+/).filter(Boolean).map((line) => ({ id: createId('line'), text: line })) : [],
    thinking: '', agentSteps: [], images: [], attachments: [], streaming: false,
  }
}

async function openConversation(id) {
  try {
    const record = await requestJson(`/api/conversations/${encodeURIComponent(id)}`)
    conversationId.value = record.id
    conversationTitle.value = record.title || '历史对话'
    messages.value = (record.messages || []).map(restoredMessage)
    mobileMenuOpen.value = false
    await nextTick()
    scrollToBottom()
    setStatus('已打开历史对话', '会继续携带已保存的上下文。')
  } catch (error) { setStatus('读取历史失败', error.message, 'error') }
}

async function deleteConversation(id) {
  try {
    await requestJson(`/api/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' })
    conversations.value = conversations.value.filter((item) => item.id !== id)
    if (conversationId.value === id) newConversation()
    setStatus('历史对话已删除', '此记录已从本地移除。')
  } catch (error) { setStatus('删除失败', error.message, 'error') }
}

function scheduleSave() {
  if (saveTimer) window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(saveConversation, 250)
}

async function saveConversation() {
  if (!conversationId.value || !messages.value.some((item) => item.text)) return
  const serializable = messages.value.filter((item) => item.text).map((item) => ({
    role: item.role,
    content: item.text,
    ...(item.role === 'assistant' && item.modelContent ? { model_content: item.modelContent } : {}),
  }))
  try {
    const saved = await requestJson('/api/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: conversationId.value, title: conversationTitle.value, messages: serializable }) })
    conversations.value = [saved, ...conversations.value.filter((item) => item.id !== saved.id)]
  } catch (error) { console.warn('Unable to save conversation', error) }
}

async function uploadFiles(fileList) {
  const selected = Array.from(fileList || []).slice(0, Math.max(0, 5 - pendingAttachments.value.length))
  if (!selected.length) return
  try {
    setStatus('正在上传附件', `正在处理 ${selected.length} 个文件。`, 'working')
    for (const file of selected) {
      const localId = createId('upload')
      pendingAttachments.value.push({ localId, name: file.name, uploading: true })
      const form = new FormData()
      form.append('file', file)
      const data = await requestJson('/api/attachments', { method: 'POST', body: form })
      const index = pendingAttachments.value.findIndex((item) => item.localId === localId)
      if (index >= 0) pendingAttachments.value.splice(index, 1, data)
    }
    setStatus('附件已就绪', '发送后会与本轮问题一同提供给模型。')
  } catch (error) {
    pendingAttachments.value = pendingAttachments.value.filter((item) => !item.uploading)
    setStatus('附件上传失败', error.message, 'error')
  }
}

function removeAttachment(id) { pendingAttachments.value = pendingAttachments.value.filter((item) => item.id !== id && item.localId !== id) }

function imageUrl(image) {
  const url = typeof image === 'string' ? image : image?.url
  return typeof url === 'string' && url ? url : ''
}

function latestImageSource() {
  for (let index = messages.value.length - 1; index >= 0; index -= 1) {
    const message = messages.value[index]
    const attachment = (message.attachments || []).find((item) => item?.kind === 'image' && item.id)
    if (attachment) return { type: 'attachment', attachment: { ...attachment }, index }
    const image = (message.images || []).find((item) => imageUrl(item))
    if (image) return { type: 'generated', url: imageUrl(image), index }
  }
  return null
}

function isImageEditRequest(text) {
  const source = latestImageSource()
  if (!source) return false
  const value = String(text || '').trim()
  const editVerb = /(修改|编辑|改图|修图|重绘|改成|换成|变成|替换|去掉|删除|添加|增加|调整|美化|涂掉|change|edit|modify|retouch|redraw|replace|remove|delete|add|turn|make)/i
  const imageReference = /(图片|图像|照片|头像|插画|这张|这幅|这图|这张图|image|picture|photo|portrait|illustration)/i
  return editVerb.test(value) && (imageReference.test(value) || source.index === messages.value.length - 1)
}

function imageFileName(contentType) {
  const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }[contentType] || 'png'
  return `edit-source-${Date.now()}.${extension}`
}

async function uploadGeneratedImage(url) {
  let response
  try {
    response = await fetch(url)
  } catch {
    throw new Error('无法读取待编辑图片，请重新上传原图后再试。')
  }
  if (!response.ok) throw new Error('无法读取待编辑图片，请重新上传原图后再试。')
  const blob = await response.blob()
  if (!blob.type.startsWith('image/')) throw new Error('待编辑文件不是图片，请重新上传原图后再试。')
  const form = new FormData()
  form.append('file', new File([blob], imageFileName(blob.type), { type: blob.type }))
  return requestJson('/api/attachments', { method: 'POST', body: form })
}

async function resolveImageEditAttachments(text, existingAttachments) {
  const attachments = existingAttachments.filter((item) => item?.id).map((item) => ({ ...item }))
  if (attachments.some((item) => item.kind === 'image') || !isImageEditRequest(text)) return attachments
  if (attachments.length >= 5) throw new Error('本轮附件已达到 5 项，无法自动附加待编辑图片。')
  const source = latestImageSource()
  if (source.type === 'attachment') return [source.attachment, ...attachments]
  setStatus('正在准备编辑图片', '已自动附加最近生成的图片。', 'working')
  const attachment = await uploadGeneratedImage(source.url)
  return [attachment, ...attachments]
}

function updateTtsProgress(data, assistant) {
  const stage = data?.stage || ''
  const message = data?.message || ''
  if (stage === 'loading') { assistant.status = '语音模型加载中…'; setStatus('模型加载中', message || 'IndexTTS2 正在初始化。', 'working') }
  if (stage === 'queued' || stage === 'generating') { assistant.status = '正在生成语音…'; setStatus('正在生成语音', message || '已进入语音队列。', 'working') }
  if (stage === 'ready') { assistant.status = ''; setStatus('正在朗读', '文字已显示，语音正在播放。', 'working') }
}

function appendDelta(assistant, data) {
  const text = String(data?.text || '')
  if (!text) return
  const line = { id: String(data.line_id || createId('line')), text: '', fullText: text, emotion: data.emotion_vector || [], live2d: data.live2d_control || null }
  assistant.lines.push(line)
  assistant.text = assistant.text ? `${assistant.text}\n${text}` : text
  const vector = Array.isArray(line.emotion) && line.emotion.length === 8 ? line.emotion : [0, 0, 0, 0, 0, 0, 0, .6]
  const control = line.live2d ? `##${JSON.stringify(line.live2d)}` : ''
  const serialized = `${text}&&${JSON.stringify(vector)}${control}`
  assistant.modelContent = assistant.modelContent ? `${assistant.modelContent}\n${serialized}` : serialized
  assistant.rendering = true
  textRenderQueue.push({ assistant, line, text, offset: 0 })
  renderNextTextChunk()
}

function renderNextTextChunk() {
  if (textRenderTimer || !textRenderQueue.length) return
  const render = () => {
    textRenderTimer = null
    const current = textRenderQueue[0]
    if (!current) return
    const remaining = current.text.length - current.offset
    const firstChunk = current.offset === 0
    const chunkSize = Math.max(1, Math.ceil(current.text.length / 32))
    const nextOffset = Math.min(current.text.length, current.offset + chunkSize)
    current.line.text += current.text.slice(current.offset, nextOffset)
    current.offset = nextOffset
    if (firstChunk) nextTick(followIncomingText)
    if (current.offset >= current.text.length) {
      textRenderQueue.shift()
      if (!textRenderQueue.some((item) => item.assistant === current.assistant)) current.assistant.rendering = false
    }
    if (textRenderQueue.length) textRenderTimer = window.setTimeout(render, remaining > chunkSize ? 18 : 0)
  }
  textRenderTimer = window.setTimeout(render, 0)
}

function stopTextRendering() {
  if (textRenderTimer) window.clearTimeout(textRenderTimer)
  textRenderTimer = null
  textRenderQueue.forEach((item) => { item.assistant.rendering = false })
  textRenderQueue.splice(0)
}

function enqueueAudio(data, assistant) {
  if (!data?.audio) return
  const rawSegments = Array.isArray(data.segments) && data.segments.length ? data.segments : [{ line_id: data.line_id, text: data.text }]
  const segments = rawSegments.map((segment) => ({
    ...segment,
    line_id: String(segment?.line_id ?? segment?.id ?? data.line_id ?? assistant.id),
    text: String(segment?.text || ''),
  }))
  const linesById = new Map((assistant.lines || []).map((line) => [String(line.id), line]))
  const lineStates = segments.map((segment) => {
    const line = linesById.get(String(segment.line_id))
    return {
      emotion: Array.isArray(line?.emotion) ? line.emotion : (data.emotion_vector || []),
      live2dControl: line?.live2d || null,
    }
  })
  audioQueue.push({
    url: data.audio, messageId: assistant.id, segments, lineStates,
    speakingSpeed: Number(data.speaking_speed) || speakingSpeed.value,
    emotion: data.emotion_vector || [],
  })
  if (!assistant.audioSegments) assistant.audioSegments = []
  assistant.audioSegments.push({ url: data.audio, segments, lineStates, speakingSpeed: Number(data.speaking_speed) || speakingSpeed.value })
  playNextAudio()
}

function clearHighlights() { activeMessageId.value = ''; activeLineIds.value = []; ttsSpeaking.value = false; activeEmotion.value = []; activeLive2DControl.value = null }

function activeSegmentIndex(audio, item) {
  if (!item.segments.length || !Number.isFinite(audio.duration) || audio.duration <= 0) return 0
  const weights = item.segments.map((segment) => Math.max(1, segment.text.replace(/\s/g, '').length))
  const target = Math.min(weights.reduce((sum, value) => sum + value, 0) - 1, Math.floor((audio.currentTime / audio.duration) * weights.reduce((sum, value) => sum + value, 0)))
  let total = 0
  for (let index = 0; index < weights.length; index += 1) {
    total += weights[index]
    if (target < total) return index
  }
  return weights.length - 1
}

function syncAudioSegment(audio, item) {
  const index = activeSegmentIndex(audio, item)
  const segment = item.segments[index]
  const state = item.lineStates[index] || {}
  activeMessageId.value = item.messageId
  activeLineIds.value = [String(segment.line_id)]
  activeEmotion.value = state.emotion || item.emotion || []
  activeLive2DControl.value = state.live2dControl || null
  ttsSpeaking.value = true
  if (item.activeSegmentIndex !== index) {
    item.activeSegmentIndex = index
    scrollActiveLine()
  }
}

function playNextAudio() {
  if (currentAudio || muted.value || !audioQueue.length) return
  const item = audioQueue.shift()
  const audio = new Audio(item.url)
  currentAudio = audio
  audio.preload = 'auto'
  audio.playbackRate = speakingSpeed.value || item.speakingSpeed || 1
  audio.onplay = () => {
    syncAudioSegment(audio, item)
  }
  audio.ontimeupdate = () => syncAudioSegment(audio, item)
  audio.onerror = () => finishAudio()
  audio.onended = () => {
    clearHighlights()
    window.setTimeout(finishAudio, 180)
  }
  audio.play().catch(() => finishAudio())
}
function finishAudio() {
  currentAudio = null
  clearHighlights()
  playNextAudio()
}
function stopAll() {
  currentAbortController?.abort()
  currentAbortController = null
  stopTextRendering()
  if (currentAudio) { currentAudio.pause(); currentAudio = null }
  audioQueue.splice(0)
  clearHighlights()
  busy.value = false
}
function toggleMute() {
  muted.value = !muted.value
  if (muted.value && currentAudio) { currentAudio.pause(); currentAudio = null; clearHighlights() }
  if (!muted.value) playNextAudio()
}

async function getLocationIfNeeded(text) {
  if (!/附近|周边|天气|温度|位置|location/i.test(text) || !navigator.geolocation) return null
  return new Promise((resolve) => navigator.geolocation.getCurrentPosition(
    (position) => resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy }),
    () => resolve(null), { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 },
  ))
}

async function sendMessage(text, existingAttachments = pendingAttachments.value) {
  if (busy.value || !text?.trim()) return
  if (!isReady.value) { setStatus('没有可用音色', '请检查 IndexTTS2 设置后重试。', 'error'); return }
  busy.value = true
  let attachments
  try {
    attachments = await resolveImageEditAttachments(text, existingAttachments)
  } catch (error) {
    busy.value = false
    setStatus('图片编辑准备失败', error.message, 'error')
    return
  }
  if (!conversationId.value) conversationId.value = createId('conversation')
  if (!messages.value.length) conversationTitle.value = shortTitle(text)
  const user = reactive({ id: createId('message'), role: 'user', text: text.trim(), lines: [], attachments, images: [], streaming: false })
  const assistant = reactive({ id: createId('message'), role: 'assistant', text: '', modelContent: '', lines: [], thinking: '', agentSteps: [], images: [], searchResults: [], audioSegments: [], status: '正在获取回答…', streaming: true, rendering: false })
  messages.value.push(user, assistant)
  pendingAttachments.value = []
  const controller = new AbortController()
  currentAbortController = controller
  setStatus('正在回答', '文字会通过流式传输立即显示。', 'working')
  try {
    const location = await getLocationIfNeeded(text)
    const payload = {
      message: user.text,
      history: currentHistory.value.slice(0, -1),
      attachments: user.attachments.filter((item) => item.id).map((item) => ({ id: item.id })),
      web_search: false,
      location,
      agent_enabled: true,
      live2d_model_id: activeLive2DModelId.value || null,
      voice: voice.value,
      speaking_speed: speakingSpeed.value,
      web_chat: { ...chatSettings, thinking: chatSettings.reasoning_effort !== 'none', force_web_config: forceWebConfig.value },
      web_image: { ...imageSettings, force_web_config: forceWebConfig.value },
    }
    await streamSse('/api/chat', payload, (event, data) => {
      if (event === 'status') { assistant.status = data.message || ''; setStatus('正在处理', data.message || '', 'working') }
      if (event === 'thinking') assistant.thinking += data.text || ''
      if (event === 'agent_step') assistant.agentSteps.push(typeof data === 'string' ? data : (data.message || JSON.stringify(data)))
      if (event === 'search_results') assistant.searchResults = data.results || []
      if (event === 'image' && (data.url || typeof data === 'string')) assistant.images.push(data)
      if (event === 'delta') { appendDelta(assistant, data); assistant.status = '' }
      if (event === 'audio') enqueueAudio(data, assistant)
      if (event === 'tts_progress') updateTtsProgress(data, assistant)
      if (event === 'tts_error') { assistant.status = '语音生成失败'; setStatus('语音生成失败', data.message || '', 'error') }
      if (event === 'done') { assistant.streaming = false; assistant.status = ''; if (data.answer) assistant.text = data.answer; if (data.model_history) assistant.modelContent = data.model_history; setStatus('回答完成', '语音将按生成顺序继续播放。') }
      if (event === 'error') throw new Error(data.message || '模型返回失败')
    }, controller.signal)
    if (assistant.text) scheduleSave()
  } catch (error) {
    if (error.name === 'AbortError') { assistant.streaming = false; assistant.status = assistant.text ? '已停止输出' : '已停止'; setStatus('已停止', '文字和语音输出已经停止。') }
    else { assistant.streaming = false; assistant.status = `发生错误：${error.message}`; setStatus('请求失败', error.message, 'error') }
  } finally {
    if (currentAbortController === controller) currentAbortController = null
    busy.value = false
    assistant.streaming = false
  }
}

async function replayMessage(message) {
  if (!message.text) return
  try {
    setStatus('正在生成重播语音', '此操作只重新合成当前回复。', 'working')
    const data = await requestJson('/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: message.text, voice: voice.value, speaking_speed: speakingSpeed.value }) })
    enqueueAudio({ audio: data.audio, text: message.text, line_id: message.lines?.[0]?.id || message.id, segments: message.lines, speaking_speed: data.speaking_speed }, message)
  } catch (error) { setStatus('重播失败', error.message, 'error') }
}
function retryMessage(message) {
  const index = messages.value.indexOf(message)
  if (index < 0) return
  messages.value.splice(index)
  sendMessage(message.text, message.attachments || [])
}
function editMessage(message) {
  const next = window.prompt('编辑这条消息后重新发送：', message.text)
  if (next === null || !next.trim()) return
  retryMessage({ ...message, text: next.trim() })
}
function scrollToBottom() { document.querySelector('.chat-scroll')?.scrollTo({ top: document.querySelector('.chat-scroll')?.scrollHeight || 0, behavior: 'smooth' }) }
function followIncomingText() {
  const container = document.querySelector('.chat-scroll')
  if (!container || ttsSpeaking.value) return
  const distanceFromEnd = container.scrollHeight - container.scrollTop - container.clientHeight
  if (distanceFromEnd < 96) container.scrollTop = container.scrollHeight
}
function scrollActiveLine() { nextTick(() => document.querySelector('.bubble p.speaking')?.scrollIntoView({ block: 'center', behavior: 'smooth' })) }

function saveSettings(data) {
  Object.assign(chatSettings, data.chat)
  Object.assign(imageSettings, data.image)
  forceWebConfig.value = data.force
  setStatus(data.force ? '已使用网页配置' : '优先使用 config.txt', data.force ? '下一次请求将强制使用本页设置。' : '将回退到 config.txt 的配置。')
}

onMounted(async () => { await Promise.all([loadStatus(), loadConversations()]) })
onBeforeUnmount(() => { if (saveTimer) window.clearTimeout(saveTimer); stopAll() })
</script>

<template>
  <main class="app-shell" :class="{ dark: darkMode }">
    <AppSidebar
      :conversations="conversations" :conversation-id="conversationId" :voices="voices" :voice="voice" :speaking-speed="speakingSpeed" :status="status"
      @new="newConversation" @open="openConversation" @delete="deleteConversation" @update:voice="voice = $event" @update:speaking-speed="speakingSpeed = $event"
    />

    <section class="chat-column">
      <header class="chat-header">
        <button class="icon-button mobile-only" type="button" @click="mobileMenuOpen = !mobileMenuOpen">☰</button>
        <div><span class="eyebrow">VOICE-ALIGNED CHAT</span><h1>{{ conversationTitle }}</h1></div>
        <div class="header-actions"><button class="icon-button" :title="muted ? '取消静音' : '静音'" type="button" @click="toggleMute">{{ muted ? '🔇' : '🔊' }}</button><button class="theme-switch" :class="{ on: darkMode }" type="button" title="夜间模式" @click="darkMode = !darkMode"><span></span></button><button class="icon-button" title="模型设置" type="button" @click="settingsOpen = true">⚙</button></div>
      </header>
      <div v-if="mobileMenuOpen" class="mobile-menu mobile-only">
        <button type="button" @click="newConversation">＋ 新建对话</button>
        <label>音色<select v-model="voice"><option v-for="item in voices" :key="item" :value="item">{{ item }}</option></select></label>
        <label>语速 {{ speakingSpeed.toFixed(2) }}×<input v-model.number="speakingSpeed" type="range" min="0.75" max="1.5" step="0.05" /></label>
        <strong>历史对话</strong><button v-for="item in conversations" :key="item.id" type="button" @click="openConversation(item.id)">{{ item.title }}</button>
      </div>
      <div class="chat-scroll panel-scroll">
        <div v-if="!messages.length" class="welcome"><span>✦</span><h2>新的对话，新的声音</h2><p>回答文字会先完整显示；思考过程、智能体工具记录可按需展开。朗读时会高亮当前句。</p></div>
        <ChatMessage v-for="message in messages" :key="message.id" :message="message" :active-message-id="activeMessageId" :active-line-ids="activeLineIds" @replay="replayMessage" @retry="retryMessage" @edit="editMessage" />
      </div>
      <ChatComposer
        :busy="busy" :thinking="chatSettings.reasoning_effort !== 'none'" :reasoning-effort="chatSettings.reasoning_effort" :reasoning-speed="chatSettings.reasoning_speed" :is-gpt56="isGpt56" :attachments="pendingAttachments"
        @send="sendMessage" @stop="stopAll" @upload="uploadFiles" @remove-attachment="removeAttachment"
        @update:thinking="chatSettings.thinking = $event" @update:reasoning-effort="chatSettings.reasoning_effort = $event" @update:reasoning-speed="chatSettings.reasoning_speed = $event"
      />
    </section>

    <Live2DPanel :speaking="ttsSpeaking" :emotion="activeEmotion" :live2d-control="activeLive2DControl" @model-change="activeLive2DModelId = $event" />
    <SettingsDialog :open="settingsOpen" :chat="chatSettings" :image="imageSettings" :force-web-config="forceWebConfig" :dark="darkMode" @close="settingsOpen = false" @save="saveSettings" />
  </main>
</template>

<style scoped>
.chat-column { position:relative; display:grid; min-width:0; height:100%; min-height:0; grid-template-rows:auto minmax(0,1fr) auto; padding:28px clamp(18px,4vw,82px) 0; }.chat-header { display:flex; align-items:center; justify-content:space-between; gap:15px; padding:0 0 20px; border-bottom:1px solid var(--line); }.chat-header h1 { margin:8px 0 0; font-size:30px; letter-spacing:-.04em; }.eyebrow { display:block; color:var(--muted); font:600 11px/1 ui-monospace,monospace; letter-spacing:.09em; }.header-actions { display:flex; align-items:center; gap:8px; }.theme-switch { position:relative; width:48px; height:28px; border:1px solid var(--line); border-radius:100px; background:var(--surface-soft); }.theme-switch span { position:absolute; top:3px; left:3px; width:20px; height:20px; border-radius:50%; background:var(--muted); transition:.2s; }.theme-switch.on { border-color:var(--brand); background:var(--brand-soft); }.theme-switch.on span { transform:translateX(20px); background:var(--brand); }.chat-scroll { min-height:0; overflow-x:hidden; overflow-y:auto; overscroll-behavior:contain; scrollbar-gutter:stable; padding:38px 0 18px; }.welcome { width:auto; max-width:760px; margin:52px auto; color:var(--muted); }.welcome > span { color:var(--brand); font-size:27px; }.welcome h2 { margin:13px 0 7px; color:var(--text); font-size:25px; }.welcome p { max-width:550px; margin:0; line-height:1.8; }.mobile-menu { position:absolute; top:76px; left:12px; z-index:25; display:grid; gap:8px; width:min(300px,calc(100vw - 24px)); max-height:75dvh; overflow:auto; padding:13px; border:1px solid var(--line); border-radius:12px; background:var(--surface); box-shadow:0 14px 35px rgba(0,0,0,.18); }.mobile-menu button,.mobile-menu select { width:100%; border:1px solid var(--line); border-radius:7px; padding:9px; color:var(--text); background:var(--surface); text-align:left; }.mobile-menu label { display:grid; gap:5px; color:var(--muted); font-size:12px; }.mobile-menu input { accent-color:var(--brand); }.mobile-menu strong { margin-top:5px; }
@media(max-width:720px){.chat-column{height:100dvh;min-height:0;padding:16px 0 0;overflow:hidden}.chat-header,.chat-scroll,.composer-wrap{min-width:0;width:100%}.chat-header{padding:0 12px 13px}.chat-header>div:first-of-type{min-width:0;flex:1}.chat-header h1{overflow:hidden;font-size:21px;text-overflow:ellipsis;white-space:nowrap}.header-actions{flex:none;gap:5px}.header-actions .icon-button{width:33px;height:33px;border-radius:10px}.theme-switch{width:43px;height:27px}.theme-switch.on span{transform:translateX(16px)}.chat-scroll{padding:18px 12px 8px}.welcome{margin:30px 6px}.welcome h2{font-size:21px}.welcome p{font-size:14px}.mobile-only{display:inline-grid}.chat-header>.mobile-only{flex:none}}
</style>
