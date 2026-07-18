"""本地 AI 语音聊天：每个可见文本片段均先完成 IndexTTS2 合成。"""
from __future__ import annotations

import base64
import configparser
import io
import json
import math
import os
import queue
import re
import sys
import threading
import time
import uuid
from html import unescape
from pathlib import Path
from typing import Iterator
from urllib.parse import parse_qs, quote_plus, urlparse

import httpx
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from pydantic import BaseModel, Field


APP_DIR = Path(__file__).resolve().parent
STATIC_DIR = APP_DIR / "static"
MEDIA_DIR = APP_DIR / "runtime" / "audio"
MEDIA_DIR.mkdir(parents=True, exist_ok=True)
CONVERSATIONS_PATH = MEDIA_DIR.parent / "conversations.json"
CONVERSATIONS_LOCK = threading.Lock()
DEFAULT_INDEXTTS_HOME = Path(r"D:\yzylauncher-win-Indextts20-260616\win-unpacked\python")
EMOTION_PROMPT_PATH = APP_DIR / "emotion_output_prompt.txt"
EMOTION_DELIMITER = "&&"
DEFAULT_EMOTION_VECTOR = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.6]
ATTACHMENTS_LOCK = threading.Lock()
ATTACHMENTS: dict[str, dict] = {}
MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
MAX_ATTACHMENTS_PER_MESSAGE = 5
MAX_ATTACHMENT_TEXT_CHARS = 24_000
ATTACHMENT_TTL_SECONDS = 2 * 60 * 60
TEXT_FILE_EXTENSIONS = {
    ".txt", ".md", ".csv", ".json", ".log", ".ini", ".yaml", ".yml", ".xml",
    ".py", ".js", ".ts", ".html", ".css", ".sql", ".java", ".c", ".cpp", ".h",
    ".hpp", ".sh", ".ps1", ".bat", ".cmd",
}
IMAGE_FILE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}


def normalize_provider(value: str) -> str:
    normalized = value.strip().lower().replace("-", "_").replace(" ", "_")
    aliases = {
        "openai": "openai_compatible",
        "openai_compatible": "openai_compatible",
        "openai_api": "openai_compatible",
        "lmstudio": "lm_studio",
        "lm_studio": "lm_studio",
    }
    return aliases.get(normalized, normalized)


def load_system_prompt() -> str:
    if not EMOTION_PROMPT_PATH.is_file():
        raise RuntimeError(f"找不到情绪输出约束文件：{EMOTION_PROMPT_PATH}")
    return EMOTION_PROMPT_PATH.read_text(encoding="utf-8").strip()


SYSTEM_PROMPT = load_system_prompt()


def load_settings() -> dict:
    """只读取同目录 config.txt，集中管理 API 和本地运行环境。"""
    path = APP_DIR / "config.txt"
    if not path.is_file():
        raise RuntimeError(f"找不到配置文件：{path}")
    config = configparser.ConfigParser(interpolation=None)
    config.read(path, encoding="utf-8")

    def value(section: str, option: str, default: str | None = None) -> str:
        if config.has_option(section, option):
            return config.get(section, option).strip()
        if default is not None:
            return default
        raise RuntimeError(f"config.txt 缺少 [{section}] {option} 配置。")

    def bounded_int(section: str, option: str, default: int, minimum: int, maximum: int) -> int:
        try:
            number = int(value(section, option, str(default)))
        except ValueError as error:
            raise RuntimeError(f"config.txt 的 [{section}] {option} 必须是整数。") from error
        return max(minimum, min(maximum, number))

    base_url = value("chat", "base_url", "").rstrip("/")
    if base_url and re.search(r"/(?:models|chat/completions)$", base_url, flags=re.IGNORECASE):
        raise RuntimeError("[chat] base_url 必须是 API 根路径，例如 http://127.0.0.1:1234/v1，不能填写 /models 或 /chat/completions。")

    thinking_value = value("chat", "thinking", "").lower()
    if thinking_value and thinking_value not in {"true", "false", "1", "0", "yes", "no", "on", "off"}:
        raise RuntimeError("[chat] thinking must be true or false.")
    thinking = None if not thinking_value else thinking_value in {"true", "1", "yes", "on"}

    return {
        "index_tts_home": value("index_tts", "project_home"),
        "default_voice": value("index_tts", "default_voice", ""),
        "playback_prebuffer_segments": bounded_int("index_tts", "playback_prebuffer_segments", 2, 1, 4),
        "chat": {
            "provider": normalize_provider(value("chat", "provider", "openai_compatible")),
            "api_key": value("chat", "api_key", ""),
            "base_url": base_url,
            "model": value("chat", "model", ""),
            "thinking": thinking,
        },
    }


SETTINGS = load_settings()


class WebChatSettings(BaseModel):
    provider: str = Field(default="openai_compatible", max_length=40)
    api_key: str = Field(default="", max_length=1000)
    base_url: str = Field(default="", max_length=1000)
    model: str = Field(default="", max_length=300)
    thinking: bool = False
    thinking_override: bool = False
    force_web_config: bool = False


class AttachmentReference(BaseModel):
    id: str = Field(min_length=32, max_length=64)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    history: list[dict[str, str]] = Field(default_factory=list, max_length=12)
    attachments: list[AttachmentReference] = Field(default_factory=list, max_length=MAX_ATTACHMENTS_PER_MESSAGE)
    web_search: bool = False
    voice: str = Field(min_length=1, max_length=160)
    speaking_speed: float = Field(default=1.0, ge=0.75, le=1.35)
    web_chat: WebChatSettings = Field(default_factory=WebChatSettings)


def resolve_chat_config(request: ChatRequest) -> dict:
    configured = SETTINGS["chat"]
    web = request.web_chat
    configured_provider = str(configured.get("provider", "openai_compatible")).strip().lower()
    configured_complete = bool(
        configured.get("base_url") and configured.get("model")
        and (configured.get("api_key") or configured_provider == "lm_studio")
    )

    def select(name: str) -> str:
        configured_value = str(configured.get(name, "")).strip()
        web_value = str(getattr(web, name)).strip()
        return web_value if web.force_web_config else configured_value or web_value

    provider = normalize_provider(str(web.provider).strip() if web.force_web_config or not configured_complete else configured_provider) or "openai_compatible"
    if provider not in {"openai_compatible", "lm_studio"}:
        raise RuntimeError("Unsupported provider. Choose OpenAI compatible or LM Studio.")
    base_url = select("base_url").rstrip("/")
    model = select("model")
    api_key = select("api_key")
    thinking = web.thinking if web.thinking_override or web.force_web_config or not configured_complete or configured.get("thinking") is None else bool(configured["thinking"])

    if not base_url or not model:
        raise RuntimeError("请在 config.txt 或网页模型设置中填写 base_url 和模型名称。")
    if re.search(r"/(?:models|chat/completions)$", base_url, flags=re.IGNORECASE):
        raise RuntimeError("base_url 必须填写 API 根路径，不能填写 /models 或 /chat/completions。")
    if provider != "lm_studio" and not api_key:
        raise RuntimeError("请在 config.txt 或网页模型设置中填写 API Key。")
    return {"provider": provider, "base_url": base_url, "model": model, "api_key": api_key, "thinking": thinking}


class ConversationMessage(BaseModel):
    role: str = Field(min_length=1, max_length=16)
    content: str = Field(min_length=1, max_length=10000)
    model_content: str | None = Field(default=None, max_length=12000)


class ConversationSaveRequest(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    title: str = Field(min_length=1, max_length=120)
    messages: list[ConversationMessage] = Field(min_length=1, max_length=120)


class IndexTTSService:
    """按需加载一个 IndexTTS2 实例，避免同时生成时争用显卡。"""

    def __init__(self, project_home: Path):
        self.project_home = project_home
        self.voices_dir = project_home / "voices"
        self.model_dir = project_home / "checkpoints"
        self._model = None
        self._load_lock = threading.Lock()
        self._infer_lock = threading.Lock()
        self._model_state = "not_loaded"
        self._model_error = ""

    def voices(self) -> list[str]:
        if not self.voices_dir.is_dir():
            return []
        extensions = {".wav", ".mp3", ".flac", ".ogg", ".m4a", ".aac"}
        return sorted(item.name for item in self.voices_dir.iterdir() if item.suffix.lower() in extensions)

    def _get_model(self):
        if self._model is None:
            with self._load_lock:
                if self._model is None:
                    self._model_state = "loading"
                    try:
                        if not self.model_dir.joinpath("config.yaml").is_file():
                            raise RuntimeError(f"找不到 IndexTTS2 模型目录：{self.model_dir}")
                        if str(self.project_home) not in sys.path:
                            sys.path.insert(0, str(self.project_home))
                        import torch
                        from indextts.infer_v2 import IndexTTS2

                        self._model = IndexTTS2(
                            cfg_path=str(self.model_dir / "config.yaml"),
                            model_dir=str(self.model_dir),
                            use_fp16=torch.cuda.is_available(),
                            use_cuda_kernel=False,
                            use_deepspeed=False,
                            low_vram=False,
                        )
                    except Exception as error:
                        self._model_state = "error"
                        self._model_error = str(error)
                        raise
                    self._model_state = "ready"
        return self._model

    def model_status(self) -> str:
        return self._model_state

    def synthesize(self, text: str, voice_name: str, emotion_vector: list[float], speaking_speed: float) -> str:
        # 文件名只允许来自 voices 目录的白名单，杜绝路径穿越。
        if voice_name not in self.voices():
            raise ValueError("所选音色不存在，请刷新页面后重新选择。")
        target = MEDIA_DIR / f"{int(time.time() * 1000)}-{uuid.uuid4().hex}.wav"
        with self._infer_lock:
            model = self._get_model()
            normalized_vector = model.normalize_emo_vec(emotion_vector, apply_bias=True)
            model.infer(
                spk_audio_prompt=str(self.voices_dir / voice_name),
                text=text,
                output_path=str(target),
                emo_vector=normalized_vector,
                use_random=False,
                verbose=False,
                # External streaming keeps each job short. 90 tokens is within IndexTTS2's
                # recommended 80-200 range and avoids an unnecessary second split here.
                max_text_tokens_per_segment=90,
                # Punctuation already carries a natural pause. Do not add artificial silence
                # between the small streaming jobs.
                interval_silence=0,
                speaking_speed=speaking_speed,
            )
        if not target.is_file():
            raise RuntimeError("IndexTTS2 没有生成音频文件。")
        return target.name


TTS = IndexTTSService(Path(SETTINGS["index_tts_home"]))
app = FastAPI(title="AI Voice Chat")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
app.mount("/media", StaticFiles(directory=MEDIA_DIR), name="media")


def sse(event: str, data: dict) -> bytes:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n".encode("utf-8")


def conversation_summary(record: dict) -> dict:
    return {
        "id": record["id"],
        "title": record["title"],
        "updated_at": record["updated_at"],
    }


def load_saved_conversations() -> list[dict]:
    if not CONVERSATIONS_PATH.is_file():
        return []
    try:
        data = json.loads(CONVERSATIONS_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        print(f"[History] unable to read saved conversations: {error}", flush=True)
        return []
    if not isinstance(data, list):
        return []
    return [record for record in data if isinstance(record, dict) and isinstance(record.get("id"), str)]


def write_saved_conversations(records: list[dict]) -> None:
    temporary_path = CONVERSATIONS_PATH.with_suffix(".tmp")
    temporary_path.write_text(json.dumps(records, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    temporary_path.replace(CONVERSATIONS_PATH)


def validate_conversation_id(conversation_id: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", conversation_id):
        raise HTTPException(status_code=400, detail="Invalid conversation id.")
    return conversation_id


def clean_expired_attachments() -> None:
    deadline = time.time() - ATTACHMENT_TTL_SECONDS
    with ATTACHMENTS_LOCK:
        expired = [attachment_id for attachment_id, item in ATTACHMENTS.items() if item["created_at"] < deadline]
        for attachment_id in expired:
            ATTACHMENTS.pop(attachment_id, None)


def attachment_kind(filename: str, content_type: str | None) -> str:
    suffix = Path(filename).suffix.lower()
    if suffix in IMAGE_FILE_EXTENSIONS and (not content_type or content_type.startswith("image/")):
        return "image"
    if suffix in TEXT_FILE_EXTENSIONS or (content_type or "").startswith("text/"):
        return "text"
    if suffix == ".pdf":
        return "pdf"
    if suffix == ".docx":
        return "docx"
    raise HTTPException(
        status_code=400,
        detail="暂支持图片（PNG/JPG/WEBP/GIF）、文本/代码、PDF 和 DOCX 文件。",
    )


def decode_text_file(data: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-8", "gb18030"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise HTTPException(status_code=400, detail="该文本文件编码无法识别，请保存为 UTF-8 后重新上传。")


def extract_attachment_text(kind: str, data: bytes) -> str:
    if kind == "text":
        text = decode_text_file(data)
    elif kind == "pdf":
        try:
            from pypdf import PdfReader

            reader = PdfReader(io.BytesIO(data))
            text = "\n".join((page.extract_text() or "") for page in reader.pages[:30])
        except Exception as error:
            raise HTTPException(status_code=400, detail=f"无法读取 PDF 内容：{error}") from error
    elif kind == "docx":
        try:
            from docx import Document

            document = Document(io.BytesIO(data))
            paragraphs = [paragraph.text for paragraph in document.paragraphs if paragraph.text.strip()]
            table_cells = [cell.text for table in document.tables for row in table.rows for cell in row.cells if cell.text.strip()]
            text = "\n".join(paragraphs + table_cells)
        except Exception as error:
            raise HTTPException(status_code=400, detail=f"无法读取 Word 文档内容：{error}") from error
    else:
        return ""
    text = text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="文件中没有可供模型读取的文本内容。")
    return text[:MAX_ATTACHMENT_TEXT_CHARS]


def resolve_attachments(references: list[AttachmentReference]) -> list[dict]:
    clean_expired_attachments()
    if not references:
        return []
    attachment_ids = [reference.id for reference in references]
    if len(set(attachment_ids)) != len(attachment_ids):
        raise RuntimeError("同一附件不能重复发送。")
    with ATTACHMENTS_LOCK:
        resolved = [ATTACHMENTS.get(attachment_id) for attachment_id in attachment_ids]
    if any(item is None for item in resolved):
        raise RuntimeError("有附件已失效，请重新上传后再发送。")
    return [item for item in resolved if item is not None]


def strip_html(value: str) -> str:
    value = re.sub(r"<script[\s\S]*?</script>|<style[\s\S]*?</style>", " ", value, flags=re.IGNORECASE)
    value = re.sub(r"<[^>]+>", " ", value)
    return re.sub(r"\s+", " ", unescape(value)).strip()


def unwrap_search_url(href: str) -> str:
    href = unescape(href)
    if href.startswith("//"):
        href = f"https:{href}"
    parsed = urlparse(href)
    if parsed.netloc.endswith("duckduckgo.com"):
        forwarded = parse_qs(parsed.query).get("uddg")
        if forwarded:
            return forwarded[0]
    return href


def web_search(query: str) -> list[dict[str, str]]:
    """Get a compact, citation-friendly result list without exposing a search API key."""
    if not query.strip():
        return []
    url = f"https://html.duckduckgo.com/html/?q={quote_plus(query[:1000])}"
    headers = {"User-Agent": "Mozilla/5.0 (AI-Voice-Chat local demo)"}
    try:
        with httpx.Client(timeout=15, follow_redirects=True, headers=headers) as client:
            response = client.get(url)
            response.raise_for_status()
    except httpx.HTTPError as error:
        raise RuntimeError(f"联网搜索连接失败：{error}") from error

    links: list[tuple[str, str]] = []
    for anchor in re.findall(r"<a\b[^>]*>[\s\S]*?</a>", response.text, flags=re.IGNORECASE):
        if "result__a" not in anchor:
            continue
        match = re.search(r'''href=["']([^"']+)["']''', anchor, flags=re.IGNORECASE)
        if not match:
            continue
        title = strip_html(anchor)
        href = unwrap_search_url(match.group(1))
        if title and href.startswith(("http://", "https://")):
            links.append((title, href))

    snippets = [strip_html(item) for item in re.findall(
        r'''<[^>]*class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)</(?:a|div)>''',
        response.text,
        flags=re.IGNORECASE,
    )]
    results: list[dict[str, str]] = []
    seen_urls: set[str] = set()
    for index, (title, href) in enumerate(links):
        if href in seen_urls:
            continue
        seen_urls.add(href)
        results.append({"title": title[:180], "url": href, "snippet": (snippets[index] if index < len(snippets) else "")[:500]})
        if len(results) == 5:
            break
    return results


def compose_user_content(request: ChatRequest, attachments: list[dict], search_results: list[dict[str, str]]) -> str | list[dict]:
    sections = [request.message.strip()]
    document_parts = []
    for attachment in attachments:
        if attachment["kind"] != "image":
            document_parts.append(f"【用户上传文件：{attachment['name']}】\n{attachment['text']}")
    if document_parts:
        sections.append("\n\n".join(document_parts))
    if search_results:
        sources = []
        for index, result in enumerate(search_results, start=1):
            source = f"{index}. {result['title']}\n{result['snippet']}\n来源：{result['url']}"
            sources.append(source)
        sections.append("【联网搜索结果，仅作参考；回答中请说明信息来自联网搜索，并按需标注来源】\n" + "\n\n".join(sources))
    text = "\n\n".join(section for section in sections if section)
    image_blocks = [
        {"type": "image_url", "image_url": {"url": f"data:{attachment['content_type']};base64,{attachment['data']}"}}
        for attachment in attachments if attachment["kind"] == "image"
    ]
    if not image_blocks:
        return text
    return [{"type": "text", "text": text}, *image_blocks]


def chat_messages(request: ChatRequest, attachments: list[dict] | None = None, search_results: list[dict[str, str]] | None = None) -> list[BaseMessage]:
    """将网页历史转换成 LangChain 的标准消息对象。"""
    messages: list[BaseMessage] = [SystemMessage(content=SYSTEM_PROMPT)]
    for item in request.history[-12:]:
        role, content = item.get("role"), item.get("content")
        if role in {"user", "assistant"} and isinstance(content, str) and content.strip():
            if role == "user":
                messages.append(HumanMessage(content=content[:4000]))
            else:
                # The UI intentionally stores only display text.  Rebuild every
                # assistant row into the output protocol before showing it to the
                # model, so a later turn cannot learn a vector-less format.
                messages.append(AIMessage(content=assistant_history_for_model(content)))
    messages.append(HumanMessage(content=compose_user_content(request, attachments or [], search_results or [])))
    return messages


def chunk_text(content: object) -> str:
    """兼容 LangChain 中字符串及内容块两种流式返回格式。"""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        texts: list[str] = []
        for block in content:
            if isinstance(block, str):
                texts.append(block)
            elif isinstance(block, dict) and isinstance(block.get("text"), str):
                texts.append(block["text"])
        return "".join(texts)
    return ""


def trailing_tag_prefix(text: str, tag: str) -> int:
    """返回末尾与标签开头重叠的长度，处理标签被流式分片截断的情况。"""
    for length in range(min(len(text), len(tag) - 1), 0, -1):
        if text.endswith(tag[:length]):
            return length
    return 0


def response_stream_events(chunks: Iterator[str]) -> Iterator[tuple[str, str]]:
    """Split a tagged model stream into visible answer and collapsible thinking events."""
    buffer = ""
    is_thinking = False
    for chunk in chunks:
        buffer += chunk
        while buffer:
            if is_thinking:
                end = buffer.find("</think>")
                if end == -1:
                    keep = trailing_tag_prefix(buffer, "</think>")
                    if len(buffer) > keep:
                        yield "thinking", buffer[:-keep] if keep else buffer
                    buffer = buffer[-keep:] if keep else ""
                    break
                if thought := buffer[:end]:
                    yield "thinking", thought
                buffer = buffer[end + len("</think>"):]
                is_thinking = False
                continue

            start = buffer.find("<think>")
            if start != -1:
                if visible := buffer[:start]:
                    yield "text", visible
                buffer = buffer[start + len("<think>"):]
                is_thinking = True
                continue

            keep = trailing_tag_prefix(buffer, "<think>")
            if len(buffer) > keep:
                yield "text", buffer[:-keep] if keep else buffer
            buffer = buffer[-keep:] if keep else ""

    if buffer:
        yield "thinking" if is_thinking else "text", buffer


def parse_emotion_line(raw_line: str) -> tuple[str, list[float]] | None:
    """Read `visible text&&[8 emotion values]`, with a calm fallback for bad rows."""
    raw_line = raw_line.strip()
    if not raw_line:
        return None

    text, delimiter, vector_text = raw_line.rpartition(EMOTION_DELIMITER)
    if not delimiter:
        # Some models occasionally omit one ampersand.  Accept this legacy form
        # while always emitting the canonical && form back into conversation memory.
        text, delimiter, vector_text = raw_line.rpartition("&")
    if not delimiter or not text.strip():
        return raw_line, DEFAULT_EMOTION_VECTOR.copy()
    try:
        values = json.loads(vector_text.strip().replace("，", ","))
        if not isinstance(values, list) or len(values) != 8:
            raise ValueError("expected 8 values")
        vector = [float(value) for value in values]
        if not all(math.isfinite(value) for value in vector):
            raise ValueError("vector contains a non-finite number")
        return text.strip(), [max(0.0, min(1.0, value)) for value in vector]
    except (TypeError, ValueError, json.JSONDecodeError):
        # Keep the answer readable even if a model misses the output protocol.
        return text.strip() or raw_line, DEFAULT_EMOTION_VECTOR.copy()


def assistant_history_for_model(content: str) -> str:
    """Convert UI-visible assistant text into canonical emotion-tagged history."""
    protocol_lines: list[str] = []
    for raw_line in content.splitlines():
        parsed = parse_emotion_line(raw_line)
        if not parsed:
            continue
        text, vector = parsed
        protocol_lines.append(
            f"{text}{EMOTION_DELIMITER}{json.dumps(vector, ensure_ascii=False, separators=(',', ':'))}"
        )

    if not protocol_lines:
        return ""

    # Do not cut a final emotion vector in half when applying the history limit.
    kept_lines: list[str] = []
    used = 0
    for line in protocol_lines:
        extra = len(line) + (1 if kept_lines else 0)
        if used + extra > 4000:
            break
        kept_lines.append(line)
        used += extra
    return "\n".join(kept_lines) or protocol_lines[0]


def stream_model(messages: list[BaseMessage], chat_config: dict) -> Iterator[tuple[str, str, list[float] | None]]:
    """Stream tagged thinking plus line-oriented text and IndexTTS emotion vectors."""
    provider = chat_config["provider"]
    api_key = chat_config["api_key"]
    if provider == "lm_studio":
        # LM Studio 通常不验证 API Key，但 LangChain 的 ChatOpenAI 需要非空值。
        api_key = api_key or "lm-studio"
    elif not api_key:
        raise RuntimeError("未配置聊天 API 密钥。请在 config.txt 的 [chat] 中填写 api_key。")
    # 当前机器可能配置 SOCKS/HTTP 代理；局域网 LM Studio 必须直连，不能经代理转发。
    http_client = httpx.Client(timeout=300, trust_env=provider != "lm_studio")
    try:
        model_options = {}
        if chat_config["thinking"]:
            model_options["extra_body"] = (
                {"chat_template_kwargs": {"enable_thinking": True}}
                if provider == "lm_studio" else {"enable_thinking": True}
            )
        print(f"[Chat] provider={provider} model={chat_config['model']} thinking={chat_config['thinking']}", flush=True)
        chat_model = ChatOpenAI(
            model=chat_config["model"],
            base_url=chat_config["base_url"].rstrip("/"),
            api_key=api_key,
            temperature=0.7,
            timeout=300,
            max_retries=2,
            stream_usage=False,
            http_client=http_client,
            **model_options,
        )
        raw_chunks = (chunk_text(chunk.content) for chunk in chat_model.stream(messages))
        text_buffer = ""
        full_thinking: list[str] = []
        full_raw_text: list[str] = []
        for event_type, delta in response_stream_events(chunk for chunk in raw_chunks if chunk):
            if event_type == "thinking":
                full_thinking.append(delta)
                yield "thinking", delta, None
                continue

            full_raw_text.append(delta)
            text_buffer += delta
            while "\n" in text_buffer:
                raw_line, text_buffer = text_buffer.split("\n", 1)
                parsed = parse_emotion_line(raw_line)
                if parsed:
                    text, vector = parsed
                    yield "text", text, vector
        parsed = parse_emotion_line(text_buffer)
        if parsed:
            text, vector = parsed
            yield "text", text, vector
        print("[LLM] stream completed", flush=True)
        if full_thinking:
            print(f"[LLM][thinking]\n{''.join(full_thinking)}", flush=True)
        print(f"[LLM][text]\n{''.join(full_raw_text)}", flush=True)
    except Exception as error:
        raise RuntimeError(f"LangChain 聊天模型调用失败：{str(error)[:500]}") from error
    finally:
        http_client.close()


def split_display_lines(text: str) -> list[str]:
    return [text.strip()] if text.strip() else []


@app.get("/")
def home():
    return FileResponse(STATIC_DIR / "index.html")


@app.post("/api/attachments")
async def upload_attachment(file: UploadFile = File(...)):
    """Keep the current-turn attachment in process memory; nothing is written to chat history."""
    filename = Path(file.filename or "未命名文件").name.strip()[:160] or "未命名文件"
    kind = attachment_kind(filename, file.content_type)
    try:
        data = await file.read(MAX_ATTACHMENT_BYTES + 1)
    finally:
        await file.close()
    if not data:
        raise HTTPException(status_code=400, detail="不能上传空文件。")
    if len(data) > MAX_ATTACHMENT_BYTES:
        raise HTTPException(status_code=413, detail="单个附件不能超过 10 MB。")

    content_type = file.content_type or "application/octet-stream"
    item = {
        "id": uuid.uuid4().hex,
        "name": filename,
        "kind": kind,
        "size": len(data),
        "created_at": time.time(),
        "content_type": content_type,
    }
    if kind == "image":
        mime_by_suffix = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif"}
        item["content_type"] = content_type if content_type.startswith("image/") else mime_by_suffix[Path(filename).suffix.lower()]
        item["data"] = base64.b64encode(data).decode("ascii")
    else:
        item["text"] = extract_attachment_text(kind, data)

    clean_expired_attachments()
    with ATTACHMENTS_LOCK:
        ATTACHMENTS[item["id"]] = item
    print(f"[Attachment] received kind={kind} name={filename!r} bytes={len(data)}", flush=True)
    response = {key: item[key] for key in ("id", "name", "kind", "size")}
    if kind == "image":
        response["preview_url"] = f"/api/attachments/{item['id']}/preview"
    return response


@app.get("/api/attachments/{attachment_id}/preview")
def attachment_preview(attachment_id: str):
    clean_expired_attachments()
    if not re.fullmatch(r"[0-9a-f]{32}", attachment_id):
        raise HTTPException(status_code=404, detail="Attachment not found.")
    with ATTACHMENTS_LOCK:
        item = ATTACHMENTS.get(attachment_id)
    if not item or item.get("kind") != "image":
        raise HTTPException(status_code=404, detail="Image attachment not found.")
    return Response(
        content=base64.b64decode(item["data"]),
        media_type=item["content_type"],
        headers={"Cache-Control": "no-store"},
    )


@app.get("/api/status")
def status():
    voices = TTS.voices()
    chat_config = SETTINGS["chat"]
    return {
        "configured": bool(chat_config["base_url"] and chat_config["model"] and (chat_config["api_key"] or chat_config["provider"] == "lm_studio")),
        "provider": chat_config["provider"],
        "model": chat_config["model"],
        "chat_defaults": {
            "provider": chat_config["provider"],
            "base_url": chat_config["base_url"],
            "model": chat_config["model"],
            "api_key_configured": bool(chat_config["api_key"]),
            "thinking": chat_config["thinking"],
        },
        "voices": voices,
        "default_voice": SETTINGS.get("default_voice", "") if SETTINGS.get("default_voice") in voices else (voices[0] if voices else ""),
        "index_tts_home": str(TTS.project_home),
        "playback_prebuffer_segments": SETTINGS["playback_prebuffer_segments"],
        "tts_model_state": TTS.model_status(),
    }


@app.get("/api/conversations")
def list_conversations():
    with CONVERSATIONS_LOCK:
        records = load_saved_conversations()
    records.sort(key=lambda record: float(record.get("updated_at", 0)), reverse=True)
    return {"conversations": [conversation_summary(record) for record in records]}


@app.get("/api/conversations/{conversation_id}")
def get_conversation(conversation_id: str):
    conversation_id = validate_conversation_id(conversation_id)
    with CONVERSATIONS_LOCK:
        records = load_saved_conversations()
    for record in records:
        if record["id"] == conversation_id:
            return record
    raise HTTPException(status_code=404, detail="Conversation not found.")


@app.delete("/api/conversations/{conversation_id}")
def delete_conversation(conversation_id: str):
    conversation_id = validate_conversation_id(conversation_id)
    with CONVERSATIONS_LOCK:
        records = load_saved_conversations()
        remaining = [record for record in records if record["id"] != conversation_id]
        if len(remaining) == len(records):
            raise HTTPException(status_code=404, detail="Conversation not found.")
        write_saved_conversations(remaining)
    return {"id": conversation_id}


@app.post("/api/conversations")
def save_conversation(request: ConversationSaveRequest):
    conversation_id = validate_conversation_id(request.id)
    messages: list[dict] = []
    for message in request.messages:
        if message.role not in {"user", "assistant"}:
            raise HTTPException(status_code=400, detail="Invalid conversation role.")
        messages.append(message.model_dump(exclude_none=True))

    now = time.time()
    with CONVERSATIONS_LOCK:
        records = load_saved_conversations()
        existing = next((record for record in records if record["id"] == conversation_id), None)
        record = {
            "id": conversation_id,
            "title": request.title.strip(),
            "created_at": existing.get("created_at", now) if existing else now,
            "updated_at": now,
            "messages": messages,
        }
        records = [item for item in records if item["id"] != conversation_id]
        records.insert(0, record)
        write_saved_conversations(records[:80])
    return conversation_summary(record)


@app.post("/api/chat")
def chat(request: ChatRequest):
    if request.voice not in TTS.voices():
        raise HTTPException(status_code=400, detail="音色不可用。")

    def generate():
        answer = ""
        model_history = ""
        line_number = 0
        cancel_event = threading.Event()
        completed = False
        model_events: queue.Queue[tuple[str, str, list[float] | None]] = queue.Queue()
        tts_jobs: queue.Queue[tuple[str, list[float], int, float] | None] = queue.Queue()
        tts_events: queue.Queue[tuple[str, dict]] = queue.Queue()
        attachments: list[dict] = []
        search_results: list[dict[str, str]] = []

        try:
            if request.attachments:
                yield sse("status", {"message": "正在读取上传的文件…"})
                attachments = resolve_attachments(request.attachments)
                yield sse("status", {"message": f"已读取 {len(attachments)} 个附件，正在准备模型请求…"})
            if request.web_search:
                yield sse("status", {"message": "正在联网搜索…"})
                try:
                    search_results = web_search(request.message)
                    yield sse("search_results", {"results": search_results})
                    yield sse("status", {"message": f"联网搜索完成，找到 {len(search_results)} 条参考结果。"})
                    print(f"[Search] query={request.message[:80]!r} results={len(search_results)}", flush=True)
                except Exception as error:
                    message = str(error)
                    yield sse("search_results", {"results": [], "error": message})
                    yield sse("status", {"message": "联网搜索暂不可用，将直接询问模型。"})
                    print(f"[Search] failed: {message}", flush=True)
        except Exception as error:
            yield sse("error", {"message": str(error)})
            return

        def model_worker() -> None:
            try:
                messages = chat_messages(request, attachments, search_results)
                for event_type, delta, emotion_vector in stream_model(messages, resolve_chat_config(request)):
                    if cancel_event.is_set():
                        return
                    model_events.put((event_type, delta, emotion_vector))
            except Exception as error:
                model_events.put(("model_error", str(error), None))
            finally:
                model_events.put(("model_done", "", None))

        def tts_worker() -> None:
            completed_segments = 0
            while True:
                job = tts_jobs.get()
                try:
                    if job is None:
                        return
                    segment, emotion_vector, line_id, speaking_speed = job
                    if cancel_event.is_set():
                        continue
                    model_state = TTS.model_status()
                    tts_events.put(("tts_progress", {
                        "stage": "loading" if model_state in {"not_loaded", "loading"} else "generating",
                        "line_id": line_id,
                        "completed": completed_segments,
                    }))
                    started_at = time.perf_counter()
                    print(f"[TTS] start chars={len(segment)} text={segment[:36]!r}", flush=True)
                    audio_name = TTS.synthesize(segment, request.voice, emotion_vector, speaking_speed)
                    if cancel_event.is_set():
                        continue
                    elapsed = time.perf_counter() - started_at
                    print(f"[TTS] ready chars={len(segment)} seconds={elapsed:.2f}", flush=True)
                    completed_segments += 1
                    tts_events.put(("audio", {
                        "audio": f"/media/{audio_name}",
                        "text": segment,
                        "line_id": line_id,
                        "speaking_speed": speaking_speed,
                        "lines": split_display_lines(segment),
                    }))
                    tts_events.put(("tts_progress", {
                        "stage": "ready",
                        "line_id": line_id,
                        "completed": completed_segments,
                    }))
                except Exception as error:
                    tts_events.put(("tts_error", {"message": str(error)}))
                finally:
                    tts_jobs.task_done()

        model_thread = threading.Thread(target=model_worker, name="chat-stream", daemon=True)
        tts_thread = threading.Thread(target=tts_worker, name="indextts-stream", daemon=True)
        model_thread.start()
        tts_thread.start()

        def ready_tts_events() -> Iterator[bytes]:
            while True:
                try:
                    event, data = tts_events.get_nowait()
                except queue.Empty:
                    return
                yield sse(event, data)

        def enqueue_line(text: str, emotion_vector: list[float], line_id: int) -> Iterator[bytes]:
            segment = text.strip()
            if not segment or cancel_event.is_set():
                return
            tts_jobs.put((segment, emotion_vector, line_id, request.speaking_speed))
            print(f"[TTS] queued chars={len(segment)} text={segment[:36]!r}", flush=True)
            yield sse("status", {"message": "正在预生成下一段语音…"})

        try:
            yield sse("status", {"message": "正在获取回答…"})
            model_finished = False
            tts_closed = False
            while True:
                # Audio events are checked continuously, even while the language
                # model is paused between two stream chunks.
                yield from ready_tts_events()
                if model_finished and not tts_closed:
                    answer = answer.strip()
                    tts_jobs.put(None)
                    tts_closed = True

                if model_finished and not tts_thread.is_alive() and tts_events.empty():
                    break

                try:
                    event_type, payload, emotion_vector = model_events.get(timeout=0.12)
                except queue.Empty:
                    continue

                if event_type == "model_done":
                    model_finished = True
                    continue
                if event_type == "model_error":
                    raise RuntimeError(str(payload))

                delta = str(payload)
                if event_type == "thinking":
                    yield sse("thinking", {"text": delta})
                    continue
                line_number += 1
                answer = f"{answer}\n{delta}" if answer else delta
                vector = emotion_vector or DEFAULT_EMOTION_VECTOR.copy()
                history_line = f"{delta}{EMOTION_DELIMITER}{json.dumps(vector, ensure_ascii=False, separators=(',', ':'))}"
                model_history = f"{model_history}\n{history_line}" if model_history else history_line
                yield sse("delta", {"text": delta, "line_id": line_number, "emotion_vector": vector})
                yield from enqueue_line(delta, vector, line_number)
            completed = True
            yield sse("done", {"answer": answer, "model_history": model_history})
        except Exception as error:
            yield sse("error", {"message": str(error)})
        finally:
            cancel_event.set()
            if not completed:
                print("[Chat] client stream closed; cancelling pending model and TTS work.", flush=True)
            if tts_thread.is_alive():
                tts_jobs.put(None)

    return StreamingResponse(generate(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})
