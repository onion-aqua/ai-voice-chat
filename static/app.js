const messages = document.querySelector('#messages');
const composer = document.querySelector('#composer');
const promptInput = document.querySelector('#prompt');
const sendButton = document.querySelector('#send');
const voiceSelect = document.querySelector('#voice-select');
const speedRange = document.querySelector('#speed-range');
const speedValue = document.querySelector('#speed-value');
const statusTitle = document.querySelector('#status-title');
const statusText = document.querySelector('#status-text');
const statusDot = document.querySelector('#status-dot');
const muteButton = document.querySelector('#mute-button');
const conversationTitle = document.querySelector('#conversation-title');
const conversationList = document.querySelector('#conversation-list');
const modelSettingsButton = document.querySelector('#model-settings');
const settingsModal = document.querySelector('#settings-modal');
const closeSettingsButton = document.querySelector('#close-settings');
const saveSettingsButton = document.querySelector('#save-settings');
const settingsSource = document.querySelector('#settings-source');
const webProvider = document.querySelector('#web-provider');
const webModel = document.querySelector('#web-model');
const webBaseUrl = document.querySelector('#web-base-url');
const webApiKey = document.querySelector('#web-api-key');
const webImageModel = document.querySelector('#web-image-model');
const webImageApiMode = document.querySelector('#web-image-api-mode');
const webImageResponsesModel = document.querySelector('#web-image-responses-model');
const webImageBaseUrl = document.querySelector('#web-image-base-url');
const webImageApiKey = document.querySelector('#web-image-api-key');
const thinkingButton = document.querySelector('#thinking-button');
const fileInput = document.querySelector('#file-input');
const attachButton = document.querySelector('#attach-button');
const attachmentList = document.querySelector('#attachment-list');
const forceWebConfigButton = document.querySelector('#force-web-config');
const ttsProgress = document.querySelector('#tts-progress');
const ttsProgressLabel = document.querySelector('#tts-progress-label');
const ttsProgressCount = document.querySelector('#tts-progress-count');
const live2dPanel = document.querySelector('.live2d-panel');
const live2dStage = document.querySelector('#live2d-stage');
const live2dCanvas = document.querySelector('#live2d-canvas');
const live2dFallback = document.querySelector('#live2d-fallback');
const live2dState = document.querySelector('#live2d-state');
const live2dEmotionIcon = document.querySelector('#live2d-emotion-icon');
const live2dEmotionLabel = document.querySelector('#live2d-emotion-label');

let history = [];
let conversationId = null;
let conversationRecords = [];
let conversationSaveQueue = Promise.resolve();
let pendingDeleteId = null;
let configDefaults = {};
let webChatSettings = {provider: 'openai_compatible', api_key: '', base_url: '', model: '', thinking: false, thinking_override: false, force_web_config: false};
let webImageSettings = {api_key: '', base_url: '', model: 'auto', api_mode: 'auto', responses_model: '', force_web_config: false};
let isBusy = false;
let activeRequest = null;
let isMuted = false;
let currentAudio = null;
let currentNarration = null;
let audioQueue = [];
let activeAssistant = null;
let audioWasUnlocked = false;
let playbackPrebufferSegments = 2;
let waitingForInitialNarration = false;
let narrationStarted = false;
let pendingAttachments = [];
let attachmentUploadInProgress = false;
let locationContext = null;
let locationRequestInFlight = false;
let live2dApp = null;
let live2dModel = null;
let live2dSpeaking = false;
let live2dExpression = 'calm';
let live2dNaturalSize = null;
let live2dExpressionNames = [];
let live2dPluginRegistered = false;
let live2dBaseScale = 1;
let live2dZoom = 1;
let live2dOffset = {x: 0, y: 0};
let live2dDrag = null;

const LIVE2D_ZOOM_MIN = 0.55;
const LIVE2D_ZOOM_MAX = 2.8;

const LIVE2D_EMOTIONS = {
  calm: {label: '平静待机', icon: '◌', keywords: ['托脸', '喝饮料', '猫猫嘴']},
  joy: {label: '开心朗读', icon: '✦', keywords: ['星星', '大聪明', '拿蛋糕']},
  anger: {label: '坚定朗读', icon: '◆', keywords: ['生气']},
  sadness: {label: '低落朗读', icon: '◔', keywords: ['哭']},
  fear: {label: '紧张朗读', icon: '△', keywords: ['汗']},
  disgust: {label: '克制朗读', icon: '◇', keywords: ['撅嘴']},
  depression: {label: '忧郁朗读', icon: '◒', keywords: ['托脸', '哭']},
  surprise: {label: '惊喜朗读', icon: '✧', keywords: ['星星', '帽子']},
};

function unlockAudio() {
  if (audioWasUnlocked) return;
  const unlock = new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=');
  unlock.muted = true;
  unlock.play().then(() => { audioWasUnlocked = true; }).catch(() => {});
}

function setStatus(title, text, type = 'ready') {
  statusTitle.textContent = title;
  statusText.textContent = readableError(text);
  statusDot.dataset.state = type;
}

function readableError(error) {
  if (typeof error === 'string') return error;
  if (error instanceof Error && error.message && error.message !== '[object Object]') return error.message;
  if (error && typeof error === 'object') {
    for (const key of ['message', 'detail', 'error_description', 'error']) {
      if (typeof error[key] === 'string' && error[key].trim()) return error[key];
    }
    try { return JSON.stringify(error); } catch (_) { return '发生未知错误。'; }
  }
  return error == null ? '发生未知错误。' : String(error);
}

function updateSendButton() {
  // Keep drafting available while a response is running. The send button
  // becomes the stop control, but the textarea itself must remain editable.
  promptInput.disabled = false;
  promptInput.readOnly = false;
  const label = sendButton.querySelector('span');
  const shortcut = sendButton.querySelector('kbd');
  if (isBusy) {
    label.textContent = '停止';
    shortcut.hidden = true;
    sendButton.disabled = false;
    sendButton.classList.add('is-stop');
    sendButton.title = '停止文字与语音输出';
    attachButton.disabled = true;
    thinkingButton.disabled = true;
    return;
  }
  label.textContent = '发送';
  shortcut.hidden = false;
  sendButton.disabled = !promptInput.value.trim() || attachmentUploadInProgress || locationRequestInFlight;
  sendButton.classList.remove('is-stop');
  sendButton.title = '发送消息';
  attachButton.disabled = attachmentUploadInProgress;
  thinkingButton.disabled = attachmentUploadInProgress;
}

function updateSettingsSource() {
  const forced = webChatSettings.force_web_config;
  forceWebConfigButton.classList.toggle('active', forced);
  forceWebConfigButton.setAttribute('aria-pressed', String(forced));
  forceWebConfigButton.textContent = forced ? '切换回 config.txt' : '强制使用网页配置';
  settingsSource.textContent = forced
    ? '当前会强制使用本页面填写的聊天和画图接口信息。'
    : '默认优先读取 config.txt；其中缺失的字段会自动使用本页面填写的内容。';
}

function openSettings() {
  webProvider.value = webChatSettings.provider;
  webModel.value = webChatSettings.model;
  webBaseUrl.value = webChatSettings.base_url;
  webApiKey.value = webChatSettings.api_key;
  webImageModel.value = webImageSettings.model;
  webImageApiMode.value = webImageSettings.api_mode;
  webImageResponsesModel.value = webImageSettings.responses_model;
  webImageBaseUrl.value = webImageSettings.base_url;
  webImageApiKey.value = webImageSettings.api_key;
  updateSettingsSource();
  settingsModal.hidden = false;
  webModel.focus();
}

function closeSettings() { settingsModal.hidden = true; }

function saveWebSettings() {
  webChatSettings = {
    provider: webProvider.value,
    model: webModel.value.trim(),
    base_url: webBaseUrl.value.trim(),
    api_key: webApiKey.value.trim(),
    thinking: webChatSettings.thinking,
    thinking_override: webChatSettings.thinking_override,
    force_web_config: webChatSettings.force_web_config,
  };
  webImageSettings = {
    model: webImageModel.value.trim() || 'auto',
    api_mode: webImageApiMode.value,
    responses_model: webImageResponsesModel.value.trim(),
    base_url: webImageBaseUrl.value.trim(),
    api_key: webImageApiKey.value.trim(),
    force_web_config: webImageSettings.force_web_config,
  };
  closeSettings();
  setStatus('模型设置已保存', webChatSettings.force_web_config ? '后续聊天和画图会强制使用网页配置。' : '后续聊天和画图仍优先使用 config.txt。');
}

function applyConfigDefaults(defaults = {}, imageDefaults = {}) {
  configDefaults = {...defaults};
  webChatSettings.provider = defaults.provider || webChatSettings.provider;
  webChatSettings.base_url = defaults.base_url || webChatSettings.base_url;
  webChatSettings.model = defaults.model || webChatSettings.model;
  if (typeof defaults.thinking === 'boolean') webChatSettings.thinking = defaults.thinking;
  webChatSettings.thinking_override = false;
  webChatSettings.force_web_config = false;
  webImageSettings.base_url = imageDefaults.base_url || webImageSettings.base_url;
  webImageSettings.model = imageDefaults.model || webImageSettings.model || 'auto';
  webImageSettings.api_mode = imageDefaults.api_mode || webImageSettings.api_mode || 'auto';
  webImageSettings.responses_model = imageDefaults.responses_model || webImageSettings.responses_model;
  webImageSettings.force_web_config = false;
  webApiKey.placeholder = defaults.api_key_configured ? 'config.txt 已配置；强制网页配置时请填写' : '请输入 API Key';
  webImageApiKey.placeholder = imageDefaults.api_key_configured ? 'config.txt 已配置；强制网页配置时请填写' : '留空则复用聊天 API Key';
  updateSettingsSource();
  updateThinkingButton();
}

function updateThinkingButton() {
  const enabled = webChatSettings.thinking;
  thinkingButton.classList.toggle('active', enabled);
  thinkingButton.setAttribute('aria-pressed', String(enabled));
  thinkingButton.textContent = enabled ? '思考已开' : '思考';
  thinkingButton.title = enabled ? '关闭思考模式' : '开启思考模式';
}

function needsCurrentLocation(message) {
  return /附近|周边|身边|本地|天气|温度|气温|降雨|下雨|风力|设施|公交|地铁|医院|药店|餐厅|咖啡/.test(message);
}

function requestCurrentLocation({silent = false} = {}) {
  if (!navigator.geolocation) {
    if (!silent) setStatus('浏览器不支持定位', '请使用支持地理位置的浏览器，或手动在消息中说明城市。', 'error');
    return Promise.resolve(null);
  }
  locationRequestInFlight = true;
  updateSendButton();
  if (!silent) setStatus('正在请求位置授权', '位置仅用于本轮天气与附近设施查询，不会保存到对话历史。', 'working');
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        locationContext = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy || 0,
        };
        locationRequestInFlight = false;
        updateSendButton();
        if (!silent) setStatus('位置已授权', '本轮可查询当前天气、温度和附近设施。');
        resolve(locationContext);
      },
      (error) => {
        locationRequestInFlight = false;
        updateSendButton();
        if (!silent) setStatus('未获得位置', error.message || '已拒绝位置授权；可手动说明城市。', 'error');
        resolve(null);
      },
      {enableHighAccuracy: false, timeout: 10_000, maximumAge: 5 * 60_000},
    );
  });
}

function formatAttachmentSize(size) {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function renderAttachmentList() {
  attachmentList.replaceChildren();
  attachmentList.hidden = pendingAttachments.length === 0;
  for (const attachment of pendingAttachments) {
    const chip = document.createElement('span');
    chip.className = `attachment-chip${attachment.uploading ? ' uploading' : ''}`;
    if (attachment.kind === 'image' && attachment.preview_url) {
      const preview = document.createElement('img');
      preview.className = 'attachment-thumbnail';
      preview.src = attachment.preview_url;
      preview.alt = attachment.name;
      chip.append(preview);
    }
    const name = document.createElement('span');
    name.className = 'attachment-chip-name';
    name.textContent = attachment.uploading
      ? `上传中：${attachment.name}`
      : `${attachment.kind === 'image' ? '图片' : '文件'} · ${attachment.name} (${formatAttachmentSize(attachment.size)})`;
    chip.append(name);
    if (!attachment.uploading) {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'attachment-remove';
      remove.dataset.attachmentId = attachment.id;
      remove.title = `移除 ${attachment.name}`;
      remove.setAttribute('aria-label', `移除 ${attachment.name}`);
      remove.textContent = '×';
      chip.append(remove);
    }
    attachmentList.append(chip);
  }
}

async function uploadSelectedFiles(files) {
  const selected = Array.from(files || []);
  if (!selected.length || isBusy || attachmentUploadInProgress) return;
  const remaining = 5 - pendingAttachments.length;
  if (remaining <= 0) {
    setStatus('附件数量已达上限', '每一轮最多添加 5 个附件。', 'error');
    return;
  }
  if (selected.length > remaining) setStatus('附件数量已调整', `本次只会上传前 ${remaining} 个附件。`);
  attachmentUploadInProgress = true;
  const batch = selected.slice(0, remaining).map((file) => ({
    localId: `upload-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: file.name || '未命名文件', file, uploading: true,
  }));
  pendingAttachments.push(...batch);
  renderAttachmentList();
  updateSendButton();
  try {
    for (const uploading of batch) {
      const file = uploading.file;
      setStatus('正在上传附件', uploading.name, 'working');
      const form = new FormData();
      form.append('file', file);
      const response = await fetch('/api/attachments', {method: 'POST', body: form});
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(readableError(data.detail || data));
      const index = pendingAttachments.findIndex((item) => item.localId === uploading.localId);
      if (index >= 0) pendingAttachments.splice(index, 1, data);
      renderAttachmentList();
    }
    setStatus('附件已就绪', `本轮会把 ${batch.length} 个附件一同发送给模型。`);
  } catch (error) {
    const batchIds = new Set(batch.map((item) => item.localId));
    pendingAttachments = pendingAttachments.filter((item) => !batchIds.has(item.localId));
    renderAttachmentList();
    setStatus('附件上传失败', error, 'error');
  } finally {
    attachmentUploadInProgress = false;
    fileInput.value = '';
    updateSendButton();
  }
}

function appendAttachmentSummary(bubble, attachments) {
  if (!attachments.length) return;
  const images = attachments.filter((item) => item.kind === 'image' && item.preview_url);
  if (images.length) {
    const imageGrid = document.createElement('div');
    imageGrid.className = 'user-image-preview-grid';
    for (const attachment of images) {
      const image = document.createElement('img');
      image.className = 'user-image-preview';
      image.src = attachment.preview_url;
      image.alt = attachment.name;
      image.title = attachment.name;
      imageGrid.append(image);
    }
    bubble.append(imageGrid);
  }
  const files = attachments.filter((item) => item.kind !== 'image');
  if (files.length) {
    const summary = document.createElement('div');
    summary.className = 'user-attachment-summary';
    summary.textContent = `已附加文件：${files.map((item) => item.name).join('、')}`;
    bubble.append(summary);
  }
}

function showSearchResults(view, data) {
  view.search?.remove();
  const panel = document.createElement('details');
  panel.className = 'search-panel';
  const summary = document.createElement('summary');
  const results = Array.isArray(data.results) ? data.results : [];
  summary.textContent = data.error ? '联网搜索暂不可用' : `联网搜索参考（${results.length} 条，点击展开）`;
  panel.append(summary);
  if (data.error) {
    const detail = document.createElement('p');
    detail.textContent = readableError(data.error);
    panel.append(detail);
  } else if (results.length) {
    const list = document.createElement('ol');
    for (const result of results) {
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.href = result.url;
      link.target = '_blank';
      link.rel = 'noreferrer';
      link.textContent = result.title || result.url;
      item.append(link);
      if (result.snippet) {
        const snippet = document.createElement('p');
        snippet.textContent = result.snippet;
        item.append(snippet);
      }
      list.append(item);
    }
    panel.append(list);
  } else {
    const detail = document.createElement('p');
    detail.textContent = '没有找到可用结果，模型会基于自身知识回答。';
    panel.append(detail);
  }
  view.bubble.insertBefore(panel, view.thinking);
  view.search = panel;
}

function showToolGeneratedImage(view, data) {
  view.generatedImage?.remove();
  const panel = document.createElement('div');
  panel.className = 'tool-generated-image';
  if (data.error) {
    panel.classList.add('error-message');
    panel.textContent = `自动画图失败：${readableError(data.error)}`;
  } else if (data.url) {
    const image = document.createElement('img');
    image.className = 'generated-image';
    image.src = data.url;
    image.alt = '模型生成的图片';
    image.onload = () => scrollToBottom();
    panel.append(image);
    if (data.revised_prompt) {
      const note = document.createElement('p');
      note.className = 'image-generation-note';
      note.textContent = `优化后的提示词：${data.revised_prompt}`;
      panel.append(note);
    }
  }
  view.bubble.insertBefore(panel, view.answer);
  view.generatedImage = panel;
}

function appendAgentStep(view, data) {
  const labels = {web_search: '联网搜索', browse_webpage: '阅读网页', get_local_environment: '本地环境', generate_image: '生成图片'};
  view.agent.hidden = false;
  const state = data.state || 'running';
  const stateText = {running: '执行中', completed: '已完成', failed: '失败', limited: '已限制'}[state] || '执行中';
  const key = String(data.call_id || `${data.tool}:${data.detail || ''}:${view.agentSteps}`);
  let item = view.agentItems.get(key);
  if (!item) {
    item = document.createElement('li');
    view.agentItems.set(key, item);
    view.agentList.append(item);
    view.agentSteps += 1;
  }
  item.className = `agent-step ${state}`;
  let title = item.querySelector('strong');
  if (!title) {
    title = document.createElement('strong');
    item.append(title);
  }
  title.textContent = `${labels[data.tool] || '调用工具'} · ${stateText}`;
  const detail = data.message && data.detail ? `${data.detail}：${data.message}` : (data.message || data.detail);
  if (detail) {
    let text = item.querySelector('span');
    if (!text) {
      text = document.createElement('span');
      item.append(text);
    }
    text.textContent = String(detail);
  }
  view.agentSummary.textContent = `智能体执行记录（${view.agentSteps} 步，点击展开）`;
}

function showTtsProgress(data) {
  const stage = data.stage || 'generating';
  const lineNumber = Number(data.line_id) || 1;
  const completed = Number(data.completed) || 0;
  ttsProgress.hidden = false;
  ttsProgress.className = `tts-progress ${stage}`;
  if (stage === 'loading') {
    ttsProgressLabel.textContent = '模型加载中…';
    ttsProgressCount.textContent = '';
  } else if (stage === 'ready') {
    ttsProgressLabel.textContent = '语音片段已准备';
    ttsProgressCount.textContent = `已完成 ${completed} 段`;
  } else if (stage === 'error') {
    ttsProgressLabel.textContent = readableError(data.message);
    ttsProgressCount.textContent = '';
  } else {
    ttsProgressLabel.textContent = `正在生成第 ${lineNumber} 段语音…`;
    ttsProgressCount.textContent = completed ? `已完成 ${completed} 段` : '';
  }
}

function hideTtsProgress() {
  ttsProgress.hidden = true;
  ttsProgress.className = 'tts-progress';
}

function selectedSpeakingSpeed() { return Number(speedRange.value); }

function updateSpeedLabel() { speedValue.textContent = `${selectedSpeakingSpeed().toFixed(2)}×`; }

function applyCurrentPlaybackRate() {
  if (!currentAudio || !currentNarration) return;
  currentAudio.playbackRate = selectedSpeakingSpeed() / currentNarration.speakingSpeed;
  currentAudio.preservesPitch = true;
}

function scrollToBottom() { messages.scrollTop = messages.scrollHeight; }

function setConversationTitle(text) {
  const summary = text.replace(/\s+/g, ' ').trim();
  conversationTitle.textContent = summary ? (summary.length > 24 ? `${summary.slice(0, 24)}…` : summary) : '新的对话';
}

function createConversationId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `conversation-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function visibleAssistantText(content) {
  return String(content).split('\n').map((line) => line.replace(/\s*&&\s*\[[^\n]*\]\s*$/, '')).join('\n').trim();
}

function savedConversationMessages() {
  return history.map((item) => {
    if (item.role === 'assistant') {
      return {role: 'assistant', content: visibleAssistantText(item.content), model_content: item.content};
    }
    return {role: 'user', content: item.content};
  }).filter((item) => item.content.trim());
}

function historyDateLabel(timestamp) {
  const date = new Date(Number(timestamp) * 1000);
  const today = new Date();
  const sameDay = (left, right) => left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
  if (sameDay(date, today)) return '今天';
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (sameDay(date, yesterday)) return '昨天';
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function renderConversationList() {
  conversationList.replaceChildren();
  if (!conversationRecords.length) {
    const empty = document.createElement('p');
    empty.className = 'history-empty';
    empty.textContent = '暂无历史对话';
    conversationList.append(empty);
    return;
  }
  let currentGroup = '';
  let group = null;
  for (const record of conversationRecords) {
    const label = historyDateLabel(record.updated_at);
    if (label !== currentGroup) {
      currentGroup = label;
      group = document.createElement('section');
      group.className = 'history-group';
      const heading = document.createElement('span');
      heading.className = 'history-group-title';
      heading.textContent = label;
      group.append(heading);
      conversationList.append(group);
    }
    const row = document.createElement('div');
    row.className = 'history-row';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `history-item${record.id === conversationId ? ' active' : ''}`;
    button.dataset.conversationId = record.id;
    button.textContent = record.title;
    button.title = record.title;
    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = `history-delete${record.id === pendingDeleteId ? ' confirm' : ''}`;
    deleteButton.dataset.deleteConversationId = record.id;
    deleteButton.textContent = record.id === pendingDeleteId ? '确认删除' : '删除';
    deleteButton.title = record.id === pendingDeleteId ? '再次点击确认删除' : '删除此对话';
    row.append(button, deleteButton);
    group.append(row);
  }
}

async function loadConversationList() {
  try {
    const response = await fetch('/api/conversations');
    if (!response.ok) throw new Error('无法读取历史对话。');
    const data = await response.json();
    conversationRecords = Array.isArray(data.conversations) ? data.conversations : [];
    renderConversationList();
  } catch (error) {
    console.warn('Unable to load saved conversations.', error);
  }
}

async function deleteConversation(id) {
  try {
    await conversationSaveQueue;
    const response = await fetch(`/api/conversations/${encodeURIComponent(id)}`, {method: 'DELETE'});
    if (!response.ok) throw new Error('无法删除历史对话。');
    conversationRecords = conversationRecords.filter((record) => record.id !== id);
    pendingDeleteId = null;
    if (conversationId === id) resetConversation();
    else renderConversationList();
    setStatus('历史对话已删除', '该记录已从本机移除。');
  } catch (error) {
    pendingDeleteId = null;
    renderConversationList();
    setStatus('删除失败', error, 'error');
  }
}

function queueConversationSave() {
  const id = conversationId;
  const messagesToSave = savedConversationMessages();
  const title = conversationTitle.textContent.trim();
  if (!id || !messagesToSave.length || !title) return;
  const payload = {id, title, messages: messagesToSave};
  conversationSaveQueue = conversationSaveQueue.catch(() => {}).then(async () => {
    const response = await fetch('/api/conversations', {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error('无法保存历史对话。');
    const saved = await response.json();
    conversationRecords = [saved, ...conversationRecords.filter((record) => record.id !== saved.id)];
    renderConversationList();
  }).catch((error) => console.warn('Unable to save conversation.', error));
}

function stopNarrationPlayback() {
  currentAudio?.pause();
  removeHighlights(currentNarration);
  audioQueue.forEach((narration) => {
    narration.audio.pause();
    removeHighlights(narration);
  });
  audioQueue = [];
  currentAudio = null;
  currentNarration = null;
  waitingForInitialNarration = false;
  narrationStarted = false;
  setLive2DPlaybackState(false);
}

function renderSavedConversation(savedMessages) {
  messages.replaceChildren();
  let historyIndex = 0;
  for (const item of savedMessages) {
    if (item.role === 'user') {
      createMessage('user', item.content, {historyIndex});
      historyIndex += 1;
      continue;
    }
    const bubble = createMessage('assistant');
    const answer = document.createElement('div');
    answer.className = 'answer-content';
    for (const text of String(item.content).split('\n')) {
      const line = document.createElement('div');
      line.className = 'answer-line';
      line.textContent = text || ' ';
      answer.append(line);
    }
    bubble.append(answer);
    historyIndex += 1;
  }
  messages.scrollTop = 0;
}

async function openConversation(id) {
  if (!id || id === conversationId && !isBusy) return;
  stopActiveResponse(false);
  stopNarrationPlayback();
  try {
    const response = await fetch(`/api/conversations/${encodeURIComponent(id)}`);
    if (!response.ok) throw new Error('历史对话不存在或无法读取。');
    const data = await response.json();
    const savedMessages = Array.isArray(data.messages) ? data.messages.filter((item) => item && typeof item.content === 'string') : [];
    history = savedMessages.flatMap((item) => {
      if (item.role === 'assistant') {
        return [{role: 'assistant', content: item.model_content || item.content}];
      }
      return item.role === 'user' ? [{role: 'user', content: item.content}] : [];
    });
    conversationId = data.id;
    setConversationTitle(data.title || '');
    renderSavedConversation(savedMessages);
    renderConversationList();
    setStatus('已打开历史对话', '可以在此基础上继续提问。');
  } catch (error) {
    setStatus('读取历史失败', error.message, 'error');
  }
}

function followNarrationLine(line) {
  const messagesRect = messages.getBoundingClientRect();
  const lineRect = line.getBoundingClientRect();
  const target = messages.scrollTop + lineRect.top - messagesRect.top - messages.clientHeight * 0.36;
  messages.scrollTo({top: Math.max(0, target), behavior: 'smooth'});
}

function discardMessageFromHere(article) {
  if (isBusy) {
    setStatus('请先停止当前回复', '不能在模型生成或朗读期间编辑、重试历史消息。', 'error');
    return null;
  }
  const historyIndex = Number(article.dataset.historyIndex);
  if (!Number.isInteger(historyIndex) || historyIndex < 0) return null;
  stopNarrationPlayback();
  for (let node = article; node;) {
    const next = node.nextElementSibling;
    node.remove();
    node = next;
  }
  history = history.slice(0, historyIndex);
  if (history.length) queueConversationSave();
  return String(article.dataset.userText || '').trim();
}

function retryUserMessage(article) {
  if (article.dataset.hasAttachments === 'true') {
    setStatus('需要重新上传附件', '带图片或文件的消息不能自动重试，请重新上传后发送。', 'error');
    return;
  }
  const text = discardMessageFromHere(article);
  if (!text) return;
  unlockAudio();
  ask(text);
}

function editUserMessage(article) {
  const text = discardMessageFromHere(article);
  if (!text) return;
  promptInput.value = text;
  promptInput.dispatchEvent(new Event('input'));
  promptInput.focus();
  setStatus('正在编辑消息', '已移除该消息及其后的回复；修改后重新发送即可。');
}

function addUserMessageActions(article) {
  const actions = document.createElement('div');
  actions.className = 'message-actions';
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'message-action';
  retry.title = '重新发送此消息';
  retry.setAttribute('aria-label', '重新发送此消息');
  retry.textContent = '↻';
  retry.addEventListener('click', () => retryUserMessage(article));
  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'message-action';
  edit.title = '编辑此消息';
  edit.setAttribute('aria-label', '编辑此消息');
  edit.textContent = '✎';
  edit.addEventListener('click', () => editUserMessage(article));
  actions.append(retry, edit);
  article.append(actions);
}

function createMessage(role, text = '', options = {}) {
  const article = document.createElement('article');
  article.className = `message ${role}`;
  const label = document.createElement('div');
  label.className = 'message-label';
  label.textContent = role === 'user' ? '你' : '声语';
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;
  article.append(label, bubble);
  if (role === 'user') {
    article.dataset.userText = text;
    article.dataset.historyIndex = String(options.historyIndex ?? history.length);
    addUserMessageActions(article);
  }
  messages.append(article);
  scrollToBottom();
  return bubble;
}

function createAssistantView() {
  const bubble = createMessage('assistant');
  const agent = document.createElement('details');
  agent.className = 'agent-panel';
  agent.hidden = true;
  const agentSummary = document.createElement('summary');
  agentSummary.textContent = '智能体执行记录（点击展开）';
  const agentList = document.createElement('ol');
  agentList.className = 'agent-step-list';
  agent.append(agentSummary, agentList);
  const thinking = document.createElement('details');
  thinking.className = 'thinking-panel';
  thinking.hidden = true;
  const summary = document.createElement('summary');
  summary.textContent = '思考过程（点击展开）';
  const thinkingText = document.createElement('div');
  thinkingText.className = 'thinking-text';
  thinking.append(summary, thinkingText);
  const answer = document.createElement('div');
  answer.className = 'answer-content waiting';
  answer.textContent = '正在生成回答…';
  bubble.append(agent, thinking, answer);
  return {bubble, agent, agentSummary, agentList, agentSteps: 0, agentItems: new Map(), thinking, summary, thinkingText, answer, search: null, generatedImage: null, lines: new Map(), emotionVectors: new Map()};
}

function removeHighlights(narration) {
  narration?.lineElements?.forEach((line) => line.classList.remove('active-line'));
}

function updateLineHighlight() {
  if (!currentNarration || !currentAudio || !Number.isFinite(currentAudio.duration)) return;
  const {lineElements, weights, totalWeight} = currentNarration;
  const target = Math.max(0, currentAudio.currentTime / currentAudio.duration) * totalWeight;
  let sum = 0;
  let index = lineElements.length - 1;
  for (let i = 0; i < weights.length; i += 1) {
    sum += weights[i];
    if (target <= sum) { index = i; break; }
  }
  if (currentNarration.activeIndex === index) return;
  if (currentNarration.activeIndex >= 0) lineElements[currentNarration.activeIndex]?.classList.remove('active-line');
  lineElements[index]?.classList.add('active-line');
  currentNarration.activeIndex = index;
  followNarrationLine(lineElements[index]);
}

function normalizedEmotionVector(vector) {
  const fallback = [0, 0, 0, 0, 0, 0, 0, 0.6];
  if (!Array.isArray(vector) || vector.length !== 8) return fallback;
  return vector.map((value, index) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback[index];
  });
}

function live2dEmotionForVector(vector) {
  const values = normalizedEmotionVector(vector);
  const keys = ['joy', 'anger', 'sadness', 'fear', 'disgust', 'depression', 'surprise'];
  let strongestIndex = 0;
  for (let index = 1; index < keys.length; index += 1) {
    if (values[index] > values[strongestIndex]) strongestIndex = index;
  }
  return values[strongestIndex] >= 0.14 ? keys[strongestIndex] : 'calm';
}

function setLive2DStatus(text, state = 'ready') {
  if (!live2dState) return;
  live2dState.textContent = text;
  live2dState.dataset.state = state;
}

function setLive2DMouth(openAmount = 0) {
  const coreModel = live2dModel?.internalModel?.coreModel;
  if (!coreModel?.setParameterValueById) return;
  try {
    coreModel.setParameterValueById('ParamMouthOpenY', Math.max(0, Math.min(1, openAmount)));
  } catch (_) {
    // Different Live2D models may not expose the standard mouth parameter.
  }
}

function applyLive2DExpression(vector, force = false) {
  const emotionKey = live2dEmotionForVector(vector);
  const emotion = LIVE2D_EMOTIONS[emotionKey];
  if (live2dEmotionIcon) live2dEmotionIcon.textContent = emotion.icon;
  if (live2dEmotionLabel) live2dEmotionLabel.textContent = emotion.label;
  if (!live2dModel || (!force && emotionKey === live2dExpression)) return;
  live2dExpression = emotionKey;
  const expressionName = emotion.keywords
    .map((keyword) => live2dExpressionNames.find((name) => name.includes(keyword)))
    .find(Boolean)
    || live2dExpressionNames[Object.keys(LIVE2D_EMOTIONS).indexOf(emotionKey) % Math.max(1, live2dExpressionNames.length)];
  if (!expressionName) return;
  try {
    Promise.resolve(live2dModel.expression(expressionName)).catch(() => {});
  } catch (_) {
    // Keep the demo usable with a model whose expression was rejected.
  }
}

function setLive2DPlaybackState(speaking, vector = null) {
  live2dSpeaking = Boolean(speaking);
  live2dPanel?.classList.toggle('is-speaking', live2dSpeaking);
  if (live2dSpeaking) {
    applyLive2DExpression(vector, true);
    setLive2DStatus('朗读同步', 'speaking');
    return;
  }
  setLive2DMouth(0);
  applyLive2DExpression(null, true);
  setLive2DStatus(live2dModel ? '待机' : '加载中', live2dModel ? 'ready' : 'loading');
}

function clampLive2DValue(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function clampLive2DOffset(width, height) {
  const modelWidth = live2dNaturalSize.width * live2dBaseScale * live2dZoom;
  const modelHeight = live2dNaturalSize.height * live2dBaseScale * live2dZoom;
  const maxX = Math.max(width * 0.42, (modelWidth - width) / 2 + width * 0.22);
  const maxY = Math.max(height * 0.38, (modelHeight - height) * 0.34 + height * 0.18);
  live2dOffset.x = clampLive2DValue(live2dOffset.x, -maxX, maxX);
  live2dOffset.y = clampLive2DValue(live2dOffset.y, -maxY, maxY);
}

function applyLive2DTransform() {
  if (!live2dApp || !live2dModel || !live2dStage || !live2dNaturalSize) return;
  const width = Math.max(1, Math.floor(live2dStage.clientWidth));
  const height = Math.max(1, Math.floor(live2dStage.clientHeight));
  live2dBaseScale = Math.min(width * 0.92 / live2dNaturalSize.width, height * 0.96 / live2dNaturalSize.height);
  clampLive2DOffset(width, height);
  live2dModel.scale.set(live2dBaseScale * live2dZoom);
  live2dModel.x = width / 2 + live2dOffset.x;
  live2dModel.y = height * 1.02 + live2dOffset.y;
}

function resizeLive2D() {
  if (!live2dApp || !live2dModel || !live2dStage || !live2dNaturalSize) return;
  live2dApp.renderer.resize(
    Math.max(1, Math.floor(live2dStage.clientWidth)),
    Math.max(1, Math.floor(live2dStage.clientHeight)),
  );
  applyLive2DTransform();
}

function setupLive2DControls() {
  if (!live2dCanvas || !live2dStage) return;
  const pointerPosition = (event) => {
    const bounds = live2dCanvas.getBoundingClientRect();
    return {x: event.clientX - bounds.left, y: event.clientY - bounds.top};
  };
  const finishDrag = (event) => {
    if (!live2dDrag || event.pointerId !== live2dDrag.pointerId) return;
    live2dDrag = null;
    live2dStage.classList.remove('is-dragging');
    if (live2dCanvas.hasPointerCapture?.(event.pointerId)) {
      live2dCanvas.releasePointerCapture(event.pointerId);
    }
  };

  live2dCanvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || !live2dModel) return;
    const point = pointerPosition(event);
    live2dDrag = {pointerId: event.pointerId, startX: point.x, startY: point.y, offsetX: live2dOffset.x, offsetY: live2dOffset.y};
    live2dCanvas.setPointerCapture?.(event.pointerId);
    live2dStage.classList.add('is-dragging');
    event.preventDefault();
  });
  live2dCanvas.addEventListener('pointermove', (event) => {
    if (!live2dDrag || event.pointerId !== live2dDrag.pointerId) return;
    const point = pointerPosition(event);
    live2dOffset.x = live2dDrag.offsetX + point.x - live2dDrag.startX;
    live2dOffset.y = live2dDrag.offsetY + point.y - live2dDrag.startY;
    applyLive2DTransform();
  });
  live2dCanvas.addEventListener('pointerup', finishDrag);
  live2dCanvas.addEventListener('pointercancel', finishDrag);
  live2dCanvas.addEventListener('wheel', (event) => {
    if (!live2dModel) return;
    event.preventDefault();
    const previousZoom = live2dZoom;
    const nextZoom = clampLive2DValue(previousZoom * Math.exp(-event.deltaY * 0.0015), LIVE2D_ZOOM_MIN, LIVE2D_ZOOM_MAX);
    if (nextZoom === previousZoom) return;
    const point = pointerPosition(event);
    const width = Math.max(1, live2dStage.clientWidth);
    const height = Math.max(1, live2dStage.clientHeight);
    const scaleRatio = nextZoom / previousZoom;
    live2dOffset.x = point.x - (point.x - (width / 2 + live2dOffset.x)) * scaleRatio - width / 2;
    live2dOffset.y = point.y - (point.y - (height * 1.02 + live2dOffset.y)) * scaleRatio - height * 1.02;
    live2dZoom = nextZoom;
    applyLive2DTransform();
  }, {passive: false});
  console.info('[Live2D] drag to move; use the mouse wheel to zoom.');
}

function updateLive2DMouthFromAudio() {
  if (!live2dSpeaking || !currentAudio || currentAudio.paused) {
    setLive2DMouth(0);
    return;
  }
  // IndexTTS2 audio does not expose waveform samples to the browser.  A short,
  // deterministic mouth motion keeps the model visually aligned with speech
  // without adding another audio-processing dependency to this demo.
  const wave = (Math.sin(currentAudio.currentTime * 21) + 1) / 2;
  setLive2DMouth(0.16 + wave * 0.52);
}

async function initializeLive2D() {
  if (!live2dCanvas || !live2dStage) return;
  const Live2DModel = window.PIXI?.live2d?.Live2DModel;
  const Live2DPlugin = window.PIXI?.live2d?.Live2DPlugin;
  if (!window.PIXI || !Live2DModel || !Live2DPlugin || !window.PIXI.extensions || !window.Live2DCubismCore) {
    setLive2DStatus('不可用', 'error');
    if (live2dFallback) {
      live2dFallback.querySelector('strong').textContent = 'Live2D 渲染器未加载';
      live2dFallback.querySelector('p').textContent = '请检查网络是否可访问 Live2D 运行库。';
    }
    return;
  }
  try {
    // This local VTube-exported model has 226 independent masks. The legacy
    // renderer supports at most 64, while this engine selects high-precision
    // masks automatically. Register its render pipe before Pixi is initialized.
    if (!live2dPluginRegistered) {
      window.PIXI.extensions.add(Live2DPlugin);
      live2dPluginRegistered = true;
    }
    window.PIXI.live2d.configureCubismSDK?.({memorySizeMB: 32});
    const modelResponse = await fetch('/api/live2d/models', {cache: 'no-store'});
    const modelCatalog = await modelResponse.json().catch(() => ({}));
    const localModel = modelCatalog.default_model;
    if (!modelResponse.ok || !localModel?.url) {
      throw new Error('未在 live2dmodels 文件夹中找到 .model3.json 模型文件。');
    }
    const app = new window.PIXI.Application();
    await app.init({
      canvas: live2dCanvas,
      autoStart: true,
      antialias: true,
      backgroundAlpha: 0,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      width: Math.max(1, Math.floor(live2dStage.clientWidth)),
      height: Math.max(1, Math.floor(live2dStage.clientHeight)),
      preference: 'webgl',
    });
    const model = await Live2DModel.from(localModel.url, {autoHitTest: false, autoFocus: false});
    model.anchor.set(0.5, 1);
    app.stage.addChild(model);
    live2dApp = app;
    live2dModel = model;
    live2dExpressionNames = Array.isArray(localModel.expressions) ? localModel.expressions : [];
    live2dNaturalSize = {width: Math.max(1, model.width), height: Math.max(1, model.height)};
    const observer = new ResizeObserver(resizeLive2D);
    observer.observe(live2dStage);
    app.ticker.add(updateLive2DMouthFromAudio);
    resizeLive2D();
    setupLive2DControls();
    applyLive2DExpression(null, true);
    live2dFallback.hidden = true;
    setLive2DStatus('待机', 'ready');
  } catch (error) {
    console.warn('Live2D local model failed to load.', error);
    setLive2DStatus('加载失败', 'error');
    if (live2dFallback) {
      live2dFallback.querySelector('strong').textContent = '本地 Live2D 模型加载失败';
      live2dFallback.querySelector('p').textContent = '不影响聊天和朗读；请检查 live2dmodels 中的模型资源是否完整。';
    }
  }
}

function playNextNarration() {
  if (isMuted || currentAudio || audioQueue.length === 0) return;
  if (!narrationStarted && waitingForInitialNarration && audioQueue.length < playbackPrebufferSegments) {
    setStatus('正在缓冲语音', `已准备 ${audioQueue.length}/${playbackPrebufferSegments} 段，随后连续朗读。`, 'working');
    return;
  }
  const narration = audioQueue.shift();
  const audio = narration.audio;
  currentAudio = audio;
  currentNarration = narration;
  narration.activeIndex = -1;
  applyCurrentPlaybackRate();
  audio.addEventListener('loadedmetadata', () => {
    applyCurrentPlaybackRate();
    updateLineHighlight();
  });
  audio.addEventListener('timeupdate', updateLineHighlight);
  audio.addEventListener('play', () => {
    narrationStarted = true;
    setStatus('正在朗读', '高亮行会随连续语音同步移动。', 'speaking');
    setLive2DPlaybackState(true, narration.emotionVector);
    updateLineHighlight();
  });
  audio.addEventListener('ended', () => {
    removeHighlights(narration);
    currentAudio = null;
    currentNarration = null;
    playNextNarration();
    if (!audioQueue.length) {
      setLive2DPlaybackState(false);
      if (!isBusy) setStatus('准备就绪', '本轮语音已播放完毕。');
    }
  });
  audio.addEventListener('error', () => {
    removeHighlights(narration);
    currentAudio = null;
    currentNarration = null;
    if (!audioQueue.length) setLive2DPlaybackState(false);
    setStatus('播放失败', '音频文件无法播放，请重试。', 'error');
    playNextNarration();
  });
  audio.play().catch(() => setStatus('等待播放许可', '请点击页面任意位置后继续播放。', 'error'));
}

function queueNarration(url, lineElements, speakingSpeed, emotionVector) {
  const weights = lineElements.map((line) => Math.max(1, line.textContent.replace(/\s/g, '').length));
  const audio = new Audio();
  audio.preload = 'auto';
  audio.src = url;
  audio.load();
  audioQueue.push({
    audio, lineElements, speakingSpeed, emotionVector: normalizedEmotionVector(emotionVector),
    weights, totalWeight: weights.reduce((total, value) => total + value, 0), activeIndex: -1,
  });
  playNextNarration();
}

function appendAnswerDelta(view, text, lineId) {
  view.answer.classList.remove('waiting');
  let lineView = view.lines.get(lineId);
  if (!lineView) {
    if (view.lines.size === 0) view.answer.textContent = '';
    const line = document.createElement('div');
    line.className = 'answer-line';
    const tail = document.createTextNode('');
    line.append(tail);
    view.answer.append(line);
    lineView = {line, tail};
    view.lines.set(lineId, lineView);
  }
  lineView.tail.data += text;
}

function appendSpeechLines(view, lines, text, lineId) {
  const lineView = view.lines.get(lineId);
  if (!lineView) return [];
  const {line, tail} = lineView;
  const leadingWhitespace = tail.data.match(/^\s*/)?.[0] || '';
  if (!tail.data.slice(leadingWhitespace.length).startsWith(text)) return [];
  tail.data = tail.data.slice(leadingWhitespace.length + text.length);
  const elements = [];
  for (const line of lines) {
    const element = document.createElement('span');
    element.className = 'speech-line';
    element.textContent = line;
    lineView.line.insertBefore(element, tail);
    elements.push(element);
  }
  return elements;
}

function showError(message) {
  const bubble = createMessage('assistant', `发生错误：${readableError(message)}`);
  bubble.classList.add('error-message');
}

function resetConversation() {
  stopActiveResponse(false);
  stopNarrationPlayback();
  hideTtsProgress();
  pendingAttachments = [];
  attachmentUploadInProgress = false;
  fileInput.value = '';
  renderAttachmentList();
  history = [];
  conversationId = null;
  pendingDeleteId = null;
  setConversationTitle('');
  messages.innerHTML = `<article class="welcome"><span class="welcome-icon">✦</span><h2>新的对话，新的声音</h2><p>回答文字会先完整显示；若模型开启思考模式，可展开查看思考过程。朗读时会高亮当前句。</p></article>`;
  renderConversationList();
  setStatus('准备就绪', '选择音色，开始一段对话。');
}

function stopActiveResponse(showStatus = true) {
  const request = activeRequest;
  if (!request) return;

  request.stopped = true;
  activeRequest = null;
  request.controller.abort();
  request.placeholder?.parentElement?.remove();
  stopNarrationPlayback();
  hideTtsProgress();
  isBusy = false;
  activeAssistant = null;
  promptInput.disabled = false;
  updateSendButton();
  promptInput.focus();
  if (showStatus) setStatus('已停止', '已停止文字输出和语音播放。');
}

function createImageView() {
  const bubble = createMessage('assistant');
  const placeholder = document.createElement('div');
  placeholder.className = 'image-generation-note waiting';
  placeholder.textContent = '正在调用画图 API…';
  bubble.append(placeholder);
  return {bubble, placeholder};
}

async function askImage(prompt) {
  if (isBusy || !prompt.trim()) return;
  if (!conversationId) conversationId = createConversationId();
  hideTtsProgress();
  const controller = new AbortController();
  const request = {controller, stopped: false, kind: 'image'};
  activeRequest = request;
  isBusy = true;
  updateSendButton();
  document.querySelector('.welcome')?.remove();
  createMessage('user', prompt);
  if (!history.length) setConversationTitle(prompt);
  const view = createImageView();
  request.placeholder = view.placeholder;
  setStatus('正在画图', '图片生成可能需要几十秒，请稍候。', 'working');

  try {
    const response = await fetch('/api/images', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      signal: controller.signal,
      body: JSON.stringify({prompt, web_chat: webChatSettings, web_image: webImageSettings}),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(readableError(data.detail || data));
    if (!data.url) throw new Error('画图 API 未返回图片地址。');
    const image = document.createElement('img');
    image.className = 'generated-image';
    image.src = data.url;
    image.alt = prompt;
    image.onload = () => scrollToBottom();
    view.placeholder.replaceWith(image);
    if (data.revised_prompt) {
      const note = document.createElement('p');
      note.className = 'image-generation-note';
      note.textContent = `优化后的提示词：${data.revised_prompt}`;
      image.after(note);
    }
    setStatus('图片已生成', '可关闭画图模式后继续正常聊天。');
  } catch (error) {
    if (error.name === 'AbortError' || request.stopped) return;
    view.placeholder.replaceWith(Object.assign(document.createElement('div'), {
      className: 'image-generation-note error-message', textContent: `画图失败：${readableError(error)}`,
    }));
    setStatus('画图失败', error, 'error');
  } finally {
    if (activeRequest !== request) return;
    activeRequest = null;
    isBusy = false;
    promptInput.disabled = false;
    updateSendButton();
    promptInput.focus();
  }
}

async function ask(message, attachments = []) {
  if (isBusy || !message.trim() || !voiceSelect.value) return;
  if (!conversationId) conversationId = createConversationId();
  hideTtsProgress();
  const controller = new AbortController();
  const request = {controller, stopped: false};
  activeRequest = request;
  isBusy = true;
  if (!currentAudio && audioQueue.length === 0) {
    waitingForInitialNarration = true;
    narrationStarted = false;
  }
  updateSendButton();
  document.querySelector('.welcome')?.remove();
  const userBubble = createMessage('user', message);
  appendAttachmentSummary(userBubble, attachments);
  if (attachments.length) userBubble.parentElement.dataset.hasAttachments = 'true';
  if (!history.length) setConversationTitle(message);
  activeAssistant = createAssistantView();
  setStatus('正在回答', '文字会直接显示，不等待语音生成。', 'working');

  let fullAnswer = '';
  let answerForModel = '';
  try {
    const response = await fetch('/api/chat', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      signal: controller.signal,
      body: JSON.stringify({
        message,
        history,
        attachments: attachments.map((attachment) => ({id: attachment.id})),
        web_search: false,
        location: locationContext,
        agent_enabled: true,
        voice: voiceSelect.value,
        speaking_speed: selectedSpeakingSpeed(),
        web_chat: webChatSettings,
        web_image: webImageSettings,
      }),
    });
    if (!response.ok || !response.body) {
      const error = await response.json().catch(() => ({}));
      throw new Error(readableError(error.detail || error));
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      if (controller.signal.aborted) break;
      pending += decoder.decode(value, {stream: true});
      const events = pending.split('\n\n');
      pending = events.pop();
      for (const raw of events) {
        if (controller.signal.aborted) break;
        const event = raw.match(/^event: (.+)$/m)?.[1];
        const dataText = raw.match(/^data: (.+)$/m)?.[1];
        if (!event || !dataText) continue;
        const data = JSON.parse(dataText);
        if (event === 'status') {
          setStatus('正在处理', data.message, 'working');
        } else if (event === 'agent_step') {
          appendAgentStep(activeAssistant, data);
        } else if (event === 'search_results') {
          showSearchResults(activeAssistant, data);
        } else if (event === 'image') {
          showToolGeneratedImage(activeAssistant, data);
        } else if (event === 'thinking') {
          activeAssistant.thinking.hidden = false;
          activeAssistant.summary.textContent = '思考中（点击展开）';
          activeAssistant.thinkingText.textContent += data.text;
        } else if (event === 'delta') {
          appendAnswerDelta(activeAssistant, data.text, data.line_id);
          fullAnswer = fullAnswer ? `${fullAnswer}\n${data.text}` : data.text;
          const vector = Array.isArray(data.emotion_vector) && data.emotion_vector.length === 8
            ? data.emotion_vector : [0, 0, 0, 0, 0, 0, 0, 0.6];
          activeAssistant.emotionVectors.set(String(data.line_id), vector);
          const historyLine = `${data.text}&&${JSON.stringify(vector)}`;
          answerForModel = answerForModel ? `${answerForModel}\n${historyLine}` : historyLine;
          if (!activeAssistant.thinking.hidden) activeAssistant.summary.textContent = '思考过程（点击展开）';
        } else if (event === 'audio') {
          const lines = appendSpeechLines(activeAssistant, data.lines, data.text, data.line_id);
          const emotionVector = activeAssistant.emotionVectors.get(String(data.line_id));
          if (lines.length) queueNarration(data.audio, lines, data.speaking_speed || 1, emotionVector);
        } else if (event === 'tts_progress') {
          showTtsProgress(data);
        } else if (event === 'tts_error') {
          showTtsProgress({stage: 'error', message: data.message});
          setStatus('语音生成失败', data.message, 'error');
        } else if (event === 'done') {
          fullAnswer = data.answer || fullAnswer;
          answerForModel = data.model_history || answerForModel;
          waitingForInitialNarration = false;
          playNextNarration();
          hideTtsProgress();
        } else if (event === 'error') {
          waitingForInitialNarration = false;
          playNextNarration();
          if (activeAssistant.answer.textContent === '正在生成回答…' && activeAssistant.thinking.hidden) activeAssistant.bubble.parentElement.remove();
          hideTtsProgress();
          showError(data.message);
          setStatus('请求失败', '请检查模型或 IndexTTS2 服务日志。', 'error');
        }
      }
    }
    if (fullAnswer) {
      history.push({role: 'user', content: message}, {role: 'assistant', content: answerForModel || fullAnswer});
      queueConversationSave();
    }
  } catch (error) {
    if (error.name === 'AbortError' || request.stopped) return;
    waitingForInitialNarration = false;
    playNextNarration();
    if (activeAssistant?.answer.textContent === '正在生成回答…' && activeAssistant.thinking.hidden) activeAssistant.bubble.parentElement.remove();
    hideTtsProgress();
    showError(error);
    setStatus('连接失败', error, 'error');
  } finally {
    if (activeRequest !== request) return;
    activeRequest = null;
    isBusy = false;
    activeAssistant = null;
    promptInput.disabled = false;
    updateSendButton();
    promptInput.focus();
    if (!currentAudio && !audioQueue.length) setStatus('准备就绪', '可以继续提问。');
  }
}

async function initialize() {
  try {
    const response = await fetch('/api/status');
    const data = await response.json();
    applyConfigDefaults(data.chat_defaults, data.image_defaults);
    playbackPrebufferSegments = Math.max(1, Math.min(4, Number(data.playback_prebuffer_segments) || 2));
    voiceSelect.innerHTML = '';
    for (const voice of data.voices) voiceSelect.add(new Option(voice.replace(/\.[^.]+$/, ''), voice, false, voice === data.default_voice));
    voiceSelect.disabled = !data.voices.length;
    if (!data.voices.length) throw new Error(`未找到音色目录：${data.index_tts_home}`);
    if (data.configured) {
      const providerName = data.provider === 'lm_studio' ? 'LM Studio' : 'OpenAI 兼容接口';
      setStatus('准备就绪', `${providerName} · ${data.model}`);
    } else setStatus('需要模型设置', '请在 config.txt 或“模型设置”中填写接口信息。', 'error');
  } catch (error) { setStatus('本地服务不可用', error, 'error'); }
  await loadConversationList();
}

composer.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (isBusy) {
    stopActiveResponse();
    return;
  }
  const message = promptInput.value.trim();
  if (!message || attachmentUploadInProgress || !voiceSelect.value) return;
  const attachments = pendingAttachments.filter((attachment) => attachment.id);
  if (!locationContext && needsCurrentLocation(message)) {
    await requestCurrentLocation({silent: true});
  }
  promptInput.value = '';
  promptInput.style.height = 'auto';
  unlockAudio();
  pendingAttachments = [];
  renderAttachmentList();
  updateSendButton();
  ask(message, attachments);
});
promptInput.addEventListener('input', () => {
  promptInput.style.height = 'auto';
  promptInput.style.height = `${Math.min(promptInput.scrollHeight, 180)}px`;
  updateSendButton();
});
promptInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); composer.requestSubmit(); }
});
speedRange.addEventListener('input', () => {
  updateSpeedLabel();
  applyCurrentPlaybackRate();
});
document.querySelector('#new-chat').addEventListener('click', resetConversation);
modelSettingsButton.addEventListener('click', openSettings);
closeSettingsButton.addEventListener('click', closeSettings);
saveSettingsButton.addEventListener('click', saveWebSettings);
settingsModal.addEventListener('click', (event) => {
  if (event.target.matches('[data-close-settings]')) closeSettings();
});
forceWebConfigButton.addEventListener('click', () => {
  if (webChatSettings.force_web_config) {
    webChatSettings.force_web_config = false;
    webImageSettings.force_web_config = false;
    webChatSettings.thinking_override = false;
    if (typeof configDefaults.thinking === 'boolean') webChatSettings.thinking = configDefaults.thinking;
    setStatus('已切换到 config.txt', '下一次聊天和画图将优先使用配置文件。');
  } else {
    webChatSettings.force_web_config = true;
    webImageSettings.force_web_config = true;
    setStatus('已切换到网页配置', '下一次聊天和画图将使用本页填写的接口信息。');
  }
  updateSettingsSource();
  updateThinkingButton();
});
thinkingButton.addEventListener('click', () => {
  webChatSettings.thinking = !webChatSettings.thinking;
  webChatSettings.thinking_override = true;
  updateThinkingButton();
});
attachButton.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => { void uploadSelectedFiles(fileInput.files); });
attachmentList.addEventListener('click', (event) => {
  const remove = event.target.closest('button[data-attachment-id]');
  if (!remove || attachmentUploadInProgress) return;
  pendingAttachments = pendingAttachments.filter((attachment) => attachment.id !== remove.dataset.attachmentId);
  renderAttachmentList();
  updateSendButton();
});
conversationList.addEventListener('click', (event) => {
  const deleteButton = event.target.closest('button[data-delete-conversation-id]');
  if (deleteButton) {
    const id = deleteButton.dataset.deleteConversationId;
    if (pendingDeleteId === id) void deleteConversation(id);
    else {
      pendingDeleteId = id;
      renderConversationList();
    }
    return;
  }
  const button = event.target.closest('button[data-conversation-id]');
  if (button) openConversation(button.dataset.conversationId);
});
document.querySelectorAll('.suggestions button').forEach((button) => button.addEventListener('click', () => { promptInput.value = button.textContent; composer.requestSubmit(); }));
muteButton.addEventListener('click', () => {
  isMuted = !isMuted;
  muteButton.textContent = isMuted ? '🔇' : '🔊';
  muteButton.title = isMuted ? '恢复自动播放' : '暂停自动播放';
  if (isMuted) {
    currentAudio?.pause();
    setLive2DPlaybackState(false);
  }
  else if (currentAudio) currentAudio.play().catch(() => {});
  else playNextNarration();
});
document.addEventListener('click', () => {
  if (!isMuted && currentAudio?.paused) currentAudio.play().catch(() => {});
  else playNextNarration();
});
initialize();
void initializeLive2D();
updateSpeedLabel();
renderAttachmentList();
updateSendButton();
