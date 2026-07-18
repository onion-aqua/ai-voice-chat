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
const thinkingButton = document.querySelector('#thinking-button');
const fileInput = document.querySelector('#file-input');
const attachButton = document.querySelector('#attach-button');
const webSearchButton = document.querySelector('#web-search-button');
const attachmentList = document.querySelector('#attachment-list');
const forceWebConfigButton = document.querySelector('#force-web-config');
const ttsProgress = document.querySelector('#tts-progress');
const ttsProgressLabel = document.querySelector('#tts-progress-label');
const ttsProgressCount = document.querySelector('#tts-progress-count');

let history = [];
let conversationId = null;
let conversationRecords = [];
let conversationSaveQueue = Promise.resolve();
let pendingDeleteId = null;
let configDefaults = {};
let webChatSettings = {provider: 'openai_compatible', api_key: '', base_url: '', model: '', thinking: false, thinking_override: false, force_web_config: false};
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
let webSearchEnabled = false;

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
  const label = sendButton.querySelector('span');
  const shortcut = sendButton.querySelector('kbd');
  if (isBusy) {
    label.textContent = '停止';
    shortcut.hidden = true;
    sendButton.disabled = false;
    sendButton.classList.add('is-stop');
    sendButton.title = '停止文字与语音输出';
    attachButton.disabled = true;
    webSearchButton.disabled = true;
    thinkingButton.disabled = true;
    return;
  }
  label.textContent = '发送';
  shortcut.hidden = false;
  sendButton.disabled = !promptInput.value.trim() || attachmentUploadInProgress;
  sendButton.classList.remove('is-stop');
  sendButton.title = '发送消息';
  attachButton.disabled = attachmentUploadInProgress;
  webSearchButton.disabled = attachmentUploadInProgress;
  thinkingButton.disabled = attachmentUploadInProgress;
}

function updateSettingsSource() {
  const forced = webChatSettings.force_web_config;
  forceWebConfigButton.classList.toggle('active', forced);
  forceWebConfigButton.setAttribute('aria-pressed', String(forced));
  forceWebConfigButton.textContent = forced ? '切换回 config.txt' : '强制使用网页配置';
  settingsSource.textContent = forced
    ? '当前会强制使用本页面填写的接口信息。'
    : '默认优先读取 config.txt；其中缺失的字段会自动使用本页面填写的内容。';
}

function openSettings() {
  webProvider.value = webChatSettings.provider;
  webModel.value = webChatSettings.model;
  webBaseUrl.value = webChatSettings.base_url;
  webApiKey.value = webChatSettings.api_key;
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
  closeSettings();
  setStatus('模型设置已保存', webChatSettings.force_web_config ? '后续对话会强制使用网页配置。' : '后续对话仍优先使用 config.txt。');
}

function applyConfigDefaults(defaults = {}) {
  configDefaults = {...defaults};
  webChatSettings.provider = defaults.provider || webChatSettings.provider;
  webChatSettings.base_url = defaults.base_url || webChatSettings.base_url;
  webChatSettings.model = defaults.model || webChatSettings.model;
  if (typeof defaults.thinking === 'boolean') webChatSettings.thinking = defaults.thinking;
  webChatSettings.thinking_override = false;
  webChatSettings.force_web_config = false;
  webApiKey.placeholder = defaults.api_key_configured ? 'config.txt 已配置；强制网页配置时请填写' : '请输入 API Key';
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

function updateWebSearchButton() {
  webSearchButton.classList.toggle('active', webSearchEnabled);
  webSearchButton.setAttribute('aria-pressed', String(webSearchEnabled));
  webSearchButton.textContent = webSearchEnabled ? '联网已开' : '联网';
  webSearchButton.title = webSearchEnabled ? '关闭联网搜索' : '开启联网搜索';
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
}

function renderSavedConversation(savedMessages) {
  messages.replaceChildren();
  for (const item of savedMessages) {
    if (item.role === 'user') {
      createMessage('user', item.content);
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

function createMessage(role, text = '') {
  const article = document.createElement('article');
  article.className = `message ${role}`;
  const label = document.createElement('div');
  label.className = 'message-label';
  label.textContent = role === 'user' ? '你' : '声语';
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;
  article.append(label, bubble);
  messages.append(article);
  scrollToBottom();
  return bubble;
}

function createAssistantView() {
  const bubble = createMessage('assistant');
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
  bubble.append(thinking, answer);
  return {bubble, thinking, summary, thinkingText, answer, search: null, lines: new Map()};
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
    updateLineHighlight();
  });
  audio.addEventListener('ended', () => {
    removeHighlights(narration);
    currentAudio = null;
    currentNarration = null;
    playNextNarration();
    if (!audioQueue.length && !isBusy) setStatus('准备就绪', '本轮语音已播放完毕。');
  });
  audio.addEventListener('error', () => {
    removeHighlights(narration);
    currentAudio = null;
    currentNarration = null;
    setStatus('播放失败', '音频文件无法播放，请重试。', 'error');
    playNextNarration();
  });
  audio.play().catch(() => setStatus('等待播放许可', '请点击页面任意位置后继续播放。', 'error'));
}

function queueNarration(url, lineElements, speakingSpeed) {
  const weights = lineElements.map((line) => Math.max(1, line.textContent.replace(/\s/g, '').length));
  const audio = new Audio();
  audio.preload = 'auto';
  audio.src = url;
  audio.load();
  audioQueue.push({audio, lineElements, speakingSpeed, weights, totalWeight: weights.reduce((total, value) => total + value, 0), activeIndex: -1});
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
  stopNarrationPlayback();
  hideTtsProgress();
  isBusy = false;
  activeAssistant = null;
  promptInput.disabled = false;
  updateSendButton();
  promptInput.focus();
  if (showStatus) setStatus('已停止', '已停止文字输出和语音播放。');
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
  promptInput.disabled = true;
  document.querySelector('.welcome')?.remove();
  const userBubble = createMessage('user', message);
  appendAttachmentSummary(userBubble, attachments);
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
        web_search: webSearchEnabled,
        voice: voiceSelect.value,
        speaking_speed: selectedSpeakingSpeed(),
        web_chat: webChatSettings,
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
        } else if (event === 'search_results') {
          showSearchResults(activeAssistant, data);
        } else if (event === 'thinking') {
          activeAssistant.thinking.hidden = false;
          activeAssistant.summary.textContent = '思考中（点击展开）';
          activeAssistant.thinkingText.textContent += data.text;
        } else if (event === 'delta') {
          appendAnswerDelta(activeAssistant, data.text, data.line_id);
          fullAnswer = fullAnswer ? `${fullAnswer}\n${data.text}` : data.text;
          const vector = Array.isArray(data.emotion_vector) && data.emotion_vector.length === 8
            ? data.emotion_vector : [0, 0, 0, 0, 0, 0, 0, 0.6];
          const historyLine = `${data.text}&&${JSON.stringify(vector)}`;
          answerForModel = answerForModel ? `${answerForModel}\n${historyLine}` : historyLine;
          if (!activeAssistant.thinking.hidden) activeAssistant.summary.textContent = '思考过程（点击展开）';
        } else if (event === 'audio') {
          const lines = appendSpeechLines(activeAssistant, data.lines, data.text, data.line_id);
          if (lines.length) queueNarration(data.audio, lines, data.speaking_speed || 1);
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
    applyConfigDefaults(data.chat_defaults);
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

composer.addEventListener('submit', (event) => {
  event.preventDefault();
  if (isBusy) {
    stopActiveResponse();
    return;
  }
  const message = promptInput.value.trim();
  if (!message || !voiceSelect.value || attachmentUploadInProgress) return;
  const attachments = pendingAttachments.filter((attachment) => attachment.id);
  unlockAudio();
  promptInput.value = '';
  promptInput.style.height = 'auto';
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
    webChatSettings.thinking_override = false;
    if (typeof configDefaults.thinking === 'boolean') webChatSettings.thinking = configDefaults.thinking;
    setStatus('已切换到 config.txt', '下一次对话将优先使用配置文件。');
  } else {
    webChatSettings.force_web_config = true;
    setStatus('已切换到网页配置', '下一次对话将使用本页填写的接口信息。');
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
webSearchButton.addEventListener('click', () => {
  webSearchEnabled = !webSearchEnabled;
  updateWebSearchButton();
  setStatus(webSearchEnabled ? '联网搜索已开启' : '联网搜索已关闭', webSearchEnabled ? '下一次提问会附带实时搜索参考。' : '下一次提问只使用模型和附件内容。');
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
  if (isMuted) currentAudio?.pause();
  else if (currentAudio) currentAudio.play().catch(() => {});
  else playNextNarration();
});
document.addEventListener('click', () => {
  if (!isMuted && currentAudio?.paused) currentAudio.play().catch(() => {});
  else playNextNarration();
});
initialize();
updateSpeedLabel();
updateWebSearchButton();
renderAttachmentList();
updateSendButton();
