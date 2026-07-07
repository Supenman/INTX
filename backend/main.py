import json
import os
import re
import uuid
import base64
import asyncio
from typing import List, Dict, Any, Optional
import threading


import httpx
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel


app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
API_ENV_FILE = os.path.join(BASE_DIR, "API", ".env")
DATA_DIR = os.path.join(BASE_DIR, "data")
API_PROVIDERS_FILE = os.path.join(DATA_DIR, "api_providers.json")
GLOBAL_CONFIG_LOCK = threading.Lock()
PROVIDER_ID_RE = re.compile(r"^[a-zA-Z0-9_-]{2,40}$")

MEDIA_DIR = os.path.join(BASE_DIR, "media")
os.makedirs(os.path.join(MEDIA_DIR, "images"), exist_ok=True)
os.makedirs(os.path.join(MEDIA_DIR, "videos"), exist_ok=True)
os.makedirs(os.path.join(MEDIA_DIR, "texts"), exist_ok=True)

CANVAS_TASKS = {}
CANVAS_TASK_LOCK = asyncio.Lock()


SUPPORTED_PROVIDER_PROTOCOLS = {"openai", "apimart", "gemini", "volcengine", "runninghub", "jimeng", "codex"}
SUPPORTED_IMAGE_REQUEST_MODES = {"openai", "openai-json"}
FIXED_PROTOCOL_PROVIDER_IDS = {"modelscope", "volcengine", "jimeng", "runninghub", "codex"}

MODELSCOPE_DEFAULT_IMAGE_MODELS = [
    "Tongyi-MAI/Z-Image-Turbo",
    "Qwen/Qwen-Image-2512",
    "Qwen/Qwen-Image-Edit-2511",
    "black-forest-labs/FLUX.2-klein-9B",
]
MODELSCOPE_DEFAULT_CHAT_MODELS = [
    "Qwen/Qwen3-235B-A22B",
    "Qwen/Qwen3-VL-235B-A22B-Instruct",
    "MiniMax/MiniMax-M2.7:MiniMax",
]
MODELSCOPE_CHAT_BASE_URL = "https://api-inference.modelscope.cn/v1"

RUNNINGHUB_DEFAULT_BASE_URL = "https://www.runninghub.cn"
VOLCENGINE_DEFAULT_BASE_URL = "https://ark.cn-beijing.volces.com"
VOLCENGINE_DEFAULT_PROJECT_NAME = "default"
VOLCENGINE_DEFAULT_REGION = "cn-north-1"


def load_env_file():
    if not os.path.exists(API_ENV_FILE):
        return
    try:
        with open(API_ENV_FILE, "r", encoding="utf-8-sig") as f:
            for raw_line in f.read().splitlines():
                line = raw_line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                os.environ.setdefault(key, value)
    except Exception as e:
        print(f"加载 API/.env 失败: {e}")


load_env_file()


def provider_key_env(provider_id):
    if provider_id == "comfly":
        return "COMFLY_API_KEY"
    if provider_id == "modelscope":
        return "MODELSCOPE_API_KEY"
    if provider_id == "runninghub":
        return "RUNNINGHUB_API_KEY"
    if provider_id == "volcengine":
        return "ARK_API_KEY"
    return f"API_PROVIDER_{re.sub(r'[^A-Za-z0-9]', '_', provider_id).upper()}_KEY"


def runninghub_wallet_key_env():
    return "RUNNINGHUB_WALLET_API_KEY"


def volcengine_access_key_env():
    return "VOLCENGINE_ACCESS_KEY_ID"


def volcengine_secret_key_env():
    return "VOLCENGINE_SECRET_ACCESS_KEY"


def read_api_env_value(key):
    key = str(key or "").strip()
    if not key or not os.path.exists(API_ENV_FILE):
        return ""
    try:
        with open(API_ENV_FILE, "r", encoding="utf-8-sig") as f:
            for raw_line in f.read().splitlines():
                line = raw_line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                if k.strip() == key:
                    return v.strip().strip('"').strip("'")
    except Exception:
        pass
    return ""


def provider_env_key_value(provider_id):
    provider_id = str(provider_id or "").strip().lower()
    env_key = provider_key_env(provider_id)
    key = os.getenv(env_key, "") or read_api_env_value(env_key)
    if key:
        return key
    return ""


def runninghub_wallet_key_value():
    env_key = runninghub_wallet_key_env()
    return os.getenv(env_key, "") or read_api_env_value(env_key)


def volcengine_access_key_value():
    env_key = volcengine_access_key_env()
    return os.getenv(env_key, "") or read_api_env_value(env_key)


def volcengine_secret_key_value():
    env_key = volcengine_secret_key_env()
    return os.getenv(env_key, "") or read_api_env_value(env_key)


def mask_secret(value):
    if not value:
        return ""
    tail = value[-4:] if len(value) > 4 else value
    BULLET = "\u2022"
    return f"{BULLET*8}{tail}"


def default_api_providers():
    return [
        {
            "id": "modelscope",
            "name": "ModelScope",
            "base_url": MODELSCOPE_CHAT_BASE_URL,
            "protocol": "openai",
            "image_request_mode": "openai",
            "image_generation_endpoint": "",
            "image_edit_endpoint": "",
            "enabled": True,
            "primary": False,
            "image_models": MODELSCOPE_DEFAULT_IMAGE_MODELS,
            "chat_models": MODELSCOPE_DEFAULT_CHAT_MODELS,
            "video_models": [],
            "model_protocols": {},
            "ms_loras": [],
            "ms_defaults_version": 1,
            "rh_apps": [],
            "rh_workflows": [],
            "volcengine_project_name": VOLCENGINE_DEFAULT_PROJECT_NAME,
            "volcengine_region": VOLCENGINE_DEFAULT_REGION,
        },
        {
            "id": "runninghub",
            "name": "RunningHub",
            "base_url": RUNNINGHUB_DEFAULT_BASE_URL,
            "protocol": "runninghub",
            "image_request_mode": "openai",
            "image_generation_endpoint": "",
            "image_edit_endpoint": "",
            "enabled": True,
            "primary": False,
            "image_models": [],
            "chat_models": [],
            "video_models": [],
            "model_protocols": {},
            "ms_loras": [],
            "ms_defaults_version": 0,
            "rh_apps": [],
            "rh_workflows": [],
            "volcengine_project_name": VOLCENGINE_DEFAULT_PROJECT_NAME,
            "volcengine_region": VOLCENGINE_DEFAULT_REGION,
        },
        {
            "id": "volcengine",
            "name": "Volcengine",
            "base_url": VOLCENGINE_DEFAULT_BASE_URL,
            "protocol": "volcengine",
            "image_request_mode": "openai",
            "image_generation_endpoint": "",
            "image_edit_endpoint": "",
            "enabled": True,
            "primary": False,
            "image_models": [],
            "chat_models": [],
            "video_models": [],
            "model_protocols": {},
            "ms_loras": [],
            "ms_defaults_version": 0,
            "rh_apps": [],
            "rh_workflows": [],
            "volcengine_project_name": VOLCENGINE_DEFAULT_PROJECT_NAME,
            "volcengine_region": VOLCENGINE_DEFAULT_REGION,
        },
    ]


def model_list_from_values(values):
    deduped = []
    for value in values or []:
        item = str(value or "").strip()
        if item and item not in deduped:
            deduped.append(item)
    return deduped

def normalize_ms_loras(values):
    normalized = []
    seen = set()
    for raw in values or []:
        if not isinstance(raw, dict):
            continue
        lora_id = str(raw.get("id") or "").strip()
        if not lora_id:
            continue
        target_model = str(raw.get("target_model") or raw.get("model") or "").strip()
        if not target_model:
            continue
        key = (target_model, lora_id)
        if key in seen:
            continue
        seen.add(key)
        try:
            strength = float(raw.get("strength", raw.get("default_strength", 0.8)))
        except Exception:
            strength = 0.8
        strength = max(0.0, min(2.0, strength))
        name = re.sub(r"\s+", " ", str(raw.get("name") or "").strip())[:80]
        normalized.append({
            "id": lora_id[:180],
            "name": name or lora_id,
            "target_model": target_model[:180],
            "strength": strength,
            "enabled": bool(raw.get("enabled", True)),
            "note": str(raw.get("note") or "").strip()[:300],
        })
    return normalized


def normalize_endpoint_override(value, label):
    endpoint = str(value or "").strip()
    if not endpoint:
        return ""
    if len(endpoint) > 300 or re.search(r"\s", endpoint):
        raise HTTPException(status_code=400, detail=f"{label} 不合法")
    if re.match(r"^https?://", endpoint, re.I):
        return endpoint.rstrip("/")
    if not endpoint.startswith("/"):
        raise HTTPException(status_code=400, detail=f"{label} 需要以 /v1/... 开头")
    return endpoint


def normalize_image_request_mode(value):
    mode = str(value or "").strip().lower()
    return mode if mode in SUPPORTED_IMAGE_REQUEST_MODES else "openai"


def normalize_model_protocols(value):
    out = {}
    if isinstance(value, dict):
        for raw_name, raw_proto in value.items():
            name = str(raw_name or "").strip()
            proto = str(raw_proto or "").strip().lower()
            if name and proto in {"openai", "gemini"}:
                out[name] = proto
    return out


def normalize_runninghub_entry(raw, kind):
    if not isinstance(raw, dict):
        return None
    raw_id = raw.get("appId") if kind == "app" else raw.get("workflowId")
    entry_id = str(raw_id or raw.get("id") or "").strip()
    if not entry_id:
        return None
    title = re.sub(r"\s+", " ", str(raw.get("title") or raw.get("name") or entry_id).strip())[:120] or entry_id
    description = str(raw.get("description") or "").strip()[:300]
    fields = raw.get("fields") or []
    if not isinstance(fields, list):
        fields = []
    return {
        "id": entry_id,
        "appId" if kind == "app" else "workflowId": entry_id,
        "title": title,
        "description": description,
        "fields": fields,
        "enabled": bool(raw.get("enabled", True)),
        "hidden": bool(raw.get("hidden", False)),
    }


def normalize_runninghub_entries(values, kind):
    normalized = []
    seen = set()
    for raw in values or []:
        entry = normalize_runninghub_entry(raw, kind)
        if entry and entry["id"] not in seen:
            seen.add(entry["id"])
            normalized.append(entry)
    return normalized


def normalize_provider(item):
    provider_id = str(item.get("id") or "").strip().lower()
    if not PROVIDER_ID_RE.fullmatch(provider_id):
        raise HTTPException(status_code=400, detail=f"API 平台 ID 不合法: {provider_id or '(empty)'}")
    name = re.sub(r"\s+", " ", str(item.get("name") or provider_id).strip())[:60] or provider_id
    base_url = str(item.get("base_url") or "").strip().rstrip("/")
    if base_url and not re.match(r"^https?://", base_url):
        raise HTTPException(status_code=400, detail=f"{name} 的 Base URL 需要以 http:// 开头")
    protocol = str(item.get("protocol") or "openai").strip().lower()
    if protocol not in SUPPORTED_PROVIDER_PROTOCOLS:
        protocol = "openai"
    image_request_mode = normalize_image_request_mode(item.get("image_request_mode"))
    image_generation_endpoint = normalize_endpoint_override(item.get("image_generation_endpoint"), "文生图端口")
    image_edit_endpoint = normalize_endpoint_override(item.get("image_edit_endpoint"), "图生图/编辑端口")
    volc_project = re.sub(r"\s+", " ", str(item.get("volcengine_project_name") or "").strip())[:80]
    volc_region = re.sub(r"\s+", " ", str(item.get("volcengine_region") or "").strip())[:40]
    if provider_id == "volcengine":
        protocol = "volcengine"
        base_url = base_url or VOLCENGINE_DEFAULT_BASE_URL
        volc_project = volc_project or VOLCENGINE_DEFAULT_PROJECT_NAME
        volc_region = volc_region or VOLCENGINE_DEFAULT_REGION
    if provider_id == "jimeng":
        protocol = "jimeng"
        base_url = ""
    if provider_id == "codex":
        protocol = "codex"
        base_url = ""
    if provider_id == "runninghub":
        protocol = "runninghub"
        base_url = base_url or RUNNINGHUB_DEFAULT_BASE_URL
    return {
        "id": provider_id,
        "name": name,
        "base_url": base_url,
        "protocol": protocol,
        "image_request_mode": image_request_mode,
        "image_generation_endpoint": image_generation_endpoint,
        "image_edit_endpoint": image_edit_endpoint,
        "enabled": bool(item.get("enabled", True)),
        "primary": bool(item.get("primary", False)),
        "image_models": model_list_from_values(item.get("image_models") or []),
        "chat_models": model_list_from_values(item.get("chat_models") or []),
        "video_models": model_list_from_values(item.get("video_models") or []),
        "model_protocols": normalize_model_protocols(item.get("model_protocols")),
        "ms_loras": normalize_ms_loras(item.get("ms_loras") or []),
        "ms_defaults_version": int(item.get("ms_defaults_version") or 0),
        "rh_apps": normalize_runninghub_entries(item.get("rh_apps") or [], "app"),
        "rh_workflows": normalize_runninghub_entries(item.get("rh_workflows") or [], "workflow"),
        "volcengine_project_name": volc_project,
        "volcengine_region": volc_region,
    }


def merge_default_api_providers(providers):
    merged = [dict(item) for item in providers]
    ms_default = next((d for d in default_api_providers() if d["id"] == "modelscope"), None)
    if ms_default:
        current = next((item for item in merged if item.get("id") == "modelscope"), None)
        if not current:
            merged.append(ms_default)
        else:
            if not current.get("base_url"):
                current["base_url"] = ms_default["base_url"]
            seeded_version = int(current.get("ms_defaults_version") or 0)
            if seeded_version < 1:
                image_models = model_list_from_values([*MODELSCOPE_DEFAULT_IMAGE_MODELS, *(current.get("image_models") or [])])
                chat_models = model_list_from_values([*MODELSCOPE_DEFAULT_CHAT_MODELS, *(current.get("chat_models") or [])])
                current["image_models"] = image_models
                current["chat_models"] = chat_models
                current["ms_defaults_version"] = 1
    rh_default = next((d for d in default_api_providers() if d["id"] == "runninghub"), None)
    if rh_default:
        current = next((item for item in merged if item.get("id") == "runninghub"), None)
        if not current:
            merged.append(rh_default)
        else:
            if not current.get("base_url"):
                current["base_url"] = rh_default["base_url"]
            if not current.get("protocol") or current.get("protocol") == "openai":
                current["protocol"] = "runninghub"
    vol_default = next((d for d in default_api_providers() if d["id"] == "volcengine"), None)
    if vol_default:
        current = next((item for item in merged if item.get("id") == "volcengine"), None)
        if not current:
            merged.append(vol_default)
        else:
            if not current.get("base_url"):
                current["base_url"] = vol_default["base_url"]
            if not current.get("protocol") or current.get("protocol") == "openai":
                current["protocol"] = "volcengine"
    return merged


def load_api_providers():
    defaults = default_api_providers()
    if not os.path.exists(API_PROVIDERS_FILE):
        return defaults
    try:
        with open(API_PROVIDERS_FILE, "r", encoding="utf-8") as f:
            raw = json.load(f)
        providers = [normalize_provider(item) for item in raw if isinstance(item, dict)]
        return merge_default_api_providers(providers or defaults)
    except Exception as e:
        print(f"加载 API 平台配置失败: {e}")
        return defaults


def save_api_providers(providers):
    os.makedirs(DATA_DIR, exist_ok=True)
    with GLOBAL_CONFIG_LOCK:
        with open(API_PROVIDERS_FILE, "w", encoding="utf-8") as f:
            json.dump(providers, f, ensure_ascii=False, indent=2)


def public_provider(provider):
    key = provider_env_key_value(provider["id"])
    item = {
        **provider,
        "has_key": bool(key),
        "key_preview": mask_secret(key),
        "key_env": provider_key_env(provider["id"]),
    }
    if provider.get("id") == "runninghub":
        wallet_key = runninghub_wallet_key_value()
        item.update({
            "has_wallet_key": bool(wallet_key),
            "wallet_key_preview": mask_secret(wallet_key),
            "wallet_key_env": runninghub_wallet_key_env(),
        })
    if provider.get("id") == "volcengine":
        ak = volcengine_access_key_value()
        sk = volcengine_secret_key_value()
        item.update({
            "has_volcengine_access_key": bool(ak),
            "volcengine_access_key_preview": mask_secret(ak),
            "volcengine_access_key_env": volcengine_access_key_env(),
            "has_volcengine_secret_key": bool(sk),
            "volcengine_secret_key_preview": mask_secret(sk),
            "volcengine_secret_key_env": volcengine_secret_key_env(),
        })
    return item


def env_quote(value):
    text = str(value or "")
    if not text or re.search(r'[\s#"\']', text):
        return '"' + text.replace("\\", "\\\\").replace('"', '\\"') + '"'
    return text


def update_env_values(updates):
    os.makedirs(os.path.dirname(API_ENV_FILE), exist_ok=True)
    lines = []
    if os.path.exists(API_ENV_FILE):
        with open(API_ENV_FILE, "r", encoding="utf-8-sig") as f:
            lines = f.read().splitlines()
    seen = set()
    next_lines = []
    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in line:
            next_lines.append(line)
            continue
        key = line.split("=", 1)[0].strip()
        if key in updates:
            if updates[key] is not None:
                next_lines.append(f"{key}={env_quote(updates[key])}")
                os.environ[key] = str(updates[key] or "")
            else:
                os.environ.pop(key, None)
            seen.add(key)
        else:
            next_lines.append(line)
    for key, value in updates.items():
        if key not in seen:
            if value is not None:
                next_lines.append(f"{key}={env_quote(value)}")
                os.environ[key] = str(value or "")
    with open(API_ENV_FILE, "w", encoding="utf-8") as f:
        f.write("\n".join(next_lines).rstrip() + "\n")


def reload_env_globals():
    pass


class ApiProviderPayload(BaseModel):
    id: str = ""
    name: str = ""
    base_url: str = ""
    protocol: str = "openai"
    image_request_mode: str = "openai"
    image_generation_endpoint: str = ""
    image_edit_endpoint: str = ""
    enabled: bool = True
    primary: bool = False
    image_models: List[str] = []
    chat_models: List[str] = []
    video_models: List[str] = []
    model_protocols: Dict[str, str] = {}
    ms_loras: List[Dict[str, Any]] = []
    ms_defaults_version: int = 0
    rh_apps: List[Dict[str, Any]] = []
    rh_workflows: List[Dict[str, Any]] = []
    volcengine_project_name: str = VOLCENGINE_DEFAULT_PROJECT_NAME
    volcengine_region: str = VOLCENGINE_DEFAULT_REGION
    volcengine_access_key_id: Optional[str] = None
    volcengine_secret_access_key: Optional[str] = None
    api_key: Optional[str] = None
    wallet_api_key: Optional[str] = None
    clear_key: bool = False
    clear_wallet_key: bool = False
    clear_volcengine_access_key_id: bool = False
    clear_volcengine_secret_access_key: bool = False


class TestConnectionPayload(BaseModel):
    base_url: str = ""
    api_key: str = ""
    provider_id: str = ""
    protocol: str = "openai"
    image_request_mode: str = "openai"


@app.get("/api/providers")
async def api_providers():
    return {"providers": [public_provider(p) for p in load_api_providers()]}


@app.put("/api/providers")
async def save_providers(payload: List[ApiProviderPayload]):
    providers = []
    env_updates = {}
    raw_primary_flags = [bool(getattr(item, "primary", False)) for item in payload]
    for item in payload:
        provider = normalize_provider(item.model_dump(exclude={"api_key", "wallet_api_key", "volcengine_access_key_id", "volcengine_secret_access_key", "clear_key", "clear_wallet_key", "clear_volcengine_access_key_id", "clear_volcengine_secret_access_key"}))
        if any(existing["id"] == provider["id"] for existing in providers):
            raise HTTPException(status_code=400, detail=f"API 平台 ID 重复: {provider['id']}")
        providers.append(provider)
        if item.clear_key:
            env_updates[provider_key_env(provider["id"])] = None
        elif item.api_key is not None:
            env_updates[provider_key_env(provider["id"])] = item.api_key.strip()
        if provider["id"] == "runninghub":
            if item.clear_wallet_key:
                env_updates[runninghub_wallet_key_env()] = None
            elif item.wallet_api_key is not None:
                env_updates[runninghub_wallet_key_env()] = item.wallet_api_key.strip()
        if provider["id"] == "volcengine":
            if item.clear_volcengine_access_key_id:
                env_updates[volcengine_access_key_env()] = None
            elif item.volcengine_access_key_id is not None:
                env_updates[volcengine_access_key_env()] = item.volcengine_access_key_id.strip()
            if item.clear_volcengine_secret_access_key:
                env_updates[volcengine_secret_key_env()] = None
            elif item.volcengine_secret_access_key is not None:
                env_updates[volcengine_secret_key_env()] = item.volcengine_secret_access_key.strip()
    if not providers:
        raise HTTPException(status_code=400, detail="至少保留一个 API 平台")
    primary_indices = [i for i, flag in enumerate(raw_primary_flags) if flag]
    if primary_indices:
        winner = primary_indices[-1]
        for i, p in enumerate(providers):
            p["primary"] = (i == winner)
    save_api_providers(providers)
    if env_updates:
        update_env_values(env_updates)
        reload_env_globals()
    return {"providers": [public_provider(p) for p in providers]}


def detect_protocol(payload):
    provider_id = str(getattr(payload, "provider_id", "") or "").strip().lower()
    if provider_id in FIXED_PROTOCOL_PROVIDER_IDS:
        return provider_id
    base_url = str(getattr(payload, "base_url", "") or "").strip().lower()
    if "runninghub.cn" in base_url or "runninghub.ai" in base_url:
        return "runninghub"
    protocol = str(getattr(payload, "protocol", "") or "openai").strip().lower()
    return protocol if protocol in SUPPORTED_PROVIDER_PROTOCOLS else "openai"


def api_key_from_payload(payload):
    explicit = str(getattr(payload, "api_key", "") or "").strip()
    provider_id = str(getattr(payload, "provider_id", "") or "").strip().lower()
    if explicit:
        return explicit
    if provider_id == "runninghub":
        value = runninghub_wallet_key_value()
        if value:
            return value
    if provider_id:
        return provider_env_key_value(provider_id)
    return explicit


@app.post("/api/providers/test-connection")
async def test_provider_connection(payload: TestConnectionPayload):
    base_url = (payload.base_url or "").strip().rstrip("/")
    if not base_url:
        raise HTTPException(status_code=400, detail="请先填写请求地址")
    if not re.match(r"^https?://", base_url):
        raise HTTPException(status_code=400, detail="请求地址必须以 http:// 或 https:// 开头")
    api_key = api_key_from_payload(payload)
    if not api_key:
        raise HTTPException(status_code=400, detail="请先填写或保存 API Key")
    protocol = detect_protocol(payload)
    url = f"{base_url}/models" if base_url.endswith("/v1") else f"{base_url}/v1/models"
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(url, headers={"Authorization": f"Bearer {api_key}", "Accept": "application/json"})
        if resp.status_code >= 400:
            return {"ok": False, "status": resp.status_code, "message": resp.text[:300]}
        data = resp.json() if resp.text else {}
        items = (data.get("data") if isinstance(data, dict) else None) or []
        ids = []
        for it in items:
            if isinstance(it, str):
                ids.append(it)
            elif isinstance(it, dict):
                mid = it.get("id") or it.get("name") or it.get("model")
                if mid:
                    ids.append(str(mid))
        ids = sorted(set(ids))
        def classify(mid):
            lc = mid.lower()
            video_keys = ["veo", "sora", "wan2", "wanx", "doubao-seedance", "doubao-1", "kling", "hailuo", "video", "t2v-", "i2v-", "s2v"]
            if any(k in lc for k in video_keys):
                return "video"
            image_keys = ["image", "dalle", "dall-e", "imagen", "flux", "stable", "sdxl", "midjourney", "nano-banana", "ideogram", "fal-ai", "z-image", "qwen-image", "klein"]
            if any(k in lc for k in image_keys):
                return "image"
            return "chat"
        grouped = {"image": [], "chat": [], "video": []}
        for mid in ids:
            grouped[classify(mid)].append(mid)
        return {"ok": True, "status": resp.status_code, "model_count": len(ids), "image_models": grouped["image"], "chat_models": grouped["chat"], "video_models": grouped["video"], "all": ids}
    except httpx.HTTPError as e:
        return {"ok": False, "status": 0, "message": str(e)[:300]}


async def fetch_models_from_upstream(base_url, api_key, protocol="openai", image_request_mode="openai"):
    protocol = protocol if protocol in SUPPORTED_PROVIDER_PROTOCOLS else "openai"
    if protocol == "jimeng" or protocol == "codex":
        return {"total": 0, "image_models": [], "chat_models": [], "video_models": [], "all": []}
    base_url = (base_url or "").strip().rstrip("/")
    if not base_url:
        raise HTTPException(status_code=400, detail="请先填写请求地址")
    if not re.match(r"^https?://", base_url):
        raise HTTPException(status_code=400, detail="请求地址必须以 http:// 或 https:// 开头")
    api_key = (api_key or "").strip()
    if not api_key:
        raise HTTPException(status_code=400, detail="请先填写或保存 API Key")
    url = f"{base_url}/models" if base_url.endswith("/v1") else f"{base_url}/v1/models"
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(url, headers={"Authorization": f"Bearer {api_key}", "Accept": "application/json"})
            if resp.status_code >= 400:
                raise HTTPException(status_code=resp.status_code, detail=f"上游 /v1/models 失败: {resp.text[:300]}")
            raw = resp.json()
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"请求上游模型列表失败: {e}")
    items = raw.get("data") if isinstance(raw, dict) else None
    if not items and isinstance(raw, dict):
        items = raw.get("models") or raw.get("list") or []
    if not isinstance(items, list):
        items = []
    ids = []
    for it in items:
        if isinstance(it, str):
            ids.append(it)
        elif isinstance(it, dict):
            mid = it.get("id") or it.get("name") or it.get("model")
            if mid:
                ids.append(str(mid))
    ids = sorted(set(ids))
    def classify(mid):
        lc = mid.lower()
        video_keys = ["veo", "sora", "wan2", "wanx", "doubao-seedance", "doubao-1", "kling", "hailuo", "video", "t2v-", "i2v-", "s2v"]
        if any(k in lc for k in video_keys):
            return "video"
        image_keys = ["image", "dalle", "dall-e", "imagen", "flux", "stable", "sdxl", "midjourney", "nano-banana", "ideogram", "fal-ai", "z-image", "qwen-image", "klein"]
        if any(k in lc for k in image_keys):
            return "image"
        return "chat"
    grouped = {"image": [], "chat": [], "video": []}
    for mid in ids:
        grouped[classify(mid)].append(mid)
    return {"total": len(ids), "image_models": grouped["image"], "chat_models": grouped["chat"], "video_models": grouped["video"], "all": ids}


@app.post("/api/providers/fetch-models")
async def fetch_upstream_models_from_payload(payload: TestConnectionPayload):
    api_key = api_key_from_payload(payload)
    protocol = detect_protocol(payload)
    return await fetch_models_from_upstream(payload.base_url, api_key, protocol, payload.image_request_mode)


@app.get("/api/providers/{provider_id}/fetch-models")
async def fetch_upstream_models(provider_id: str):
    provider = None
    for p in load_api_providers():
        if p["id"] == provider_id:
            provider = p
            break
    if not provider:
        raise HTTPException(status_code=404, detail=f"未找到 API 平台: {provider_id}")
    api_key = provider_env_key_value(provider["id"])
    if not api_key:
        raise HTTPException(status_code=400, detail=f"{provider.get('name') or provider_id} 未配置 API Key")
    return await fetch_models_from_upstream(provider.get("base_url") or "", api_key, provider.get("protocol") or "openai", provider.get("image_request_mode") or "openai")


class GeneratePayload(BaseModel):
    type: str = "text"
    prompt: str = ""
    model: str = ""
    provider_id: str = ""
    aspect_ratio: Optional[str] = None
    resolution: Optional[str] = None
    duration: Optional[int] = None
    fps: Optional[int] = None
    images: List[Dict] = []
    videos: List[Dict] = []


_RESOLUTION_MAP = {
    "512": 512, "768": 768, "1K": 1024,
    "1.5K": 1536, "2K": 2048,
}
_ASPECT_RATIO_MAP = {
    "1:1": 1, "4:3": 4/3, "3:4": 3/4,
    "16:9": 16/9, "9:16": 9/16,
    "21:9": 21/9, "9:21": 9/21,
}

def compute_image_size(resolution_label, aspect_ratio_label):
    """Convert UI resolution & aspect-ratio labels to an OpenAI 'WxH' size string."""
    base = _RESOLUTION_MAP.get(resolution_label, 1024)
    ratio = _ASPECT_RATIO_MAP.get(aspect_ratio_label, 1)
    if ratio >= 1:
        w, h = base, round(base / ratio)
    else:
        w, h = round(base * ratio), base
    h = max(h, 64)
    w = max(w, 64)
    return f"{w}x{h}"


async def call_openai_compatible_api(base_url, api_key, model, prompt, generate_type, resolution=None, aspect_ratio=None, protocol="openai", images=None, videos=None):
    base_url = base_url.rstrip("/")
    if not base_url.endswith("/v1"):
        base_url = f"{base_url}/v1"
    try:
        async with httpx.AsyncClient(timeout=120) as client:
            if generate_type == "text":
                resp = await client.post(
                    f"{base_url}/chat/completions",
                    headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                    json={
                        "model": model,
                        "messages": [{"role": "user", "content": prompt}],
                        "temperature": 0.7,
                        "max_tokens": 2000
                    }
                )
                if resp.status_code >= 400:
                    raise Exception(f"API调用失败: {resp.text[:200]}")
                data = resp.json()
                text = data["choices"][0]["message"]["content"]
                return {"type": "text", "content": text}

            elif generate_type == "image":
                img_body = {"model": model, "prompt": prompt, "response_format": "url"}
                if resolution:
                    img_body["size"] = compute_image_size(resolution, aspect_ratio)

                # ModelScope protocol supports reference images via image_urls
                if protocol == "modelscope" and images:
                    img_body["image_urls"] = [img["url"] for img in images]

                resp = await client.post(
                    f"{base_url}/images/generations",
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json",
                        "X-ModelScope-Async-Mode": "true",
                    },
                    json=img_body
                )
                if resp.status_code >= 400:
                    err_text = resp.text[:300]
                    if "image_url is required" in err_text.lower():
                        raise Exception(
                            f"模型 {model} 需要输入图片（可能是图片编辑模型），"
                            f"请选择其他图片生成模型"
                        )
                    raise Exception(f"API调用失败: {err_text}")
                data = resp.json()

                # Case 1: Standard OpenAI format — data[0].url
                if "data" in data and isinstance(data["data"], list) and "url" in data["data"][0]:
                    image_url = data["data"][0]["url"]
                    return {"type": "image", "url": image_url}

                # Case 2: b64_json format — data[0].b64_json
                if "data" in data and isinstance(data["data"], list) and "b64_json" in data["data"][0]:
                    return {"type": "image", "b64_json": data["data"][0]["b64_json"]}

                # Case 3: Async task mode (ModelScope etc.) — poll for result
                task_id = data.get("task_id")
                if task_id:
                    image_url = await _poll_async_task(client, base_url, api_key, task_id)
                    return {"type": "image", "url": image_url}

                raise Exception(f"不支持的API响应格式: {str(data)[:200]}")

            elif generate_type == "video":
                vid_body = {"model": model, "prompt": prompt, "n": 1}

                # ModelScope supports reference images/videos for video generation
                if protocol == "modelscope":
                    if images:
                        vid_body["image_urls"] = [img["url"] for img in images]
                    if videos:
                        vid_body["video_urls"] = [v["url"] for v in videos]

                # Use async-mode header to support task-based video providers
                resp = await client.post(
                    f"{base_url}/videos/generations",
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json",
                        "X-ModelScope-Async-Mode": "true",
                    },
                    json=vid_body
                )
                if resp.status_code < 400:
                    data = resp.json()

                    # Standard OpenAI format
                    if "data" in data and isinstance(data["data"], list) and "url" in data["data"][0]:
                        video_url = data["data"][0]["url"]
                        return {"type": "video", "url": video_url}

                    # Async task mode
                    task_id = data.get("task_id")
                    if task_id:
                        video_url = await _poll_async_task(client, base_url, api_key, task_id)
                        return {"type": "video", "url": video_url}

                raise Exception("视频生成接口暂时不可用")
    except Exception as e:
        raise e


async def _poll_async_task(client: httpx.AsyncClient, base_url: str, api_key: str, task_id: str, timeout: int = 120) -> str:
    """Poll an async task endpoint until completion, return the output URL."""
    deadline = asyncio.get_event_loop().time() + timeout
    while True:
        if asyncio.get_event_loop().time() >= deadline:
            raise Exception(f"任务轮询超时（{timeout}秒）")
        await asyncio.sleep(2)
        poll_resp = await client.get(
            f"{base_url}/tasks/{task_id}",
            headers={
                "Authorization": f"Bearer {api_key}",
                "X-ModelScope-Task-Type": "image_generation",
            }
        )
        if poll_resp.status_code >= 400:
            raise Exception(f"查询任务状态失败: {poll_resp.text[:200]}")
        poll_data = poll_resp.json()
        status = str(poll_data.get("task_status") or "").upper()

        if status == "SUCCEED":
            output_images = poll_data.get("output_images") or poll_data.get("output", [])
            if output_images and len(output_images) > 0:
                return output_images[0]
            # Some providers return the URL directly in the response
            result_url = poll_data.get("url") or poll_data.get("result", {}).get("url")
            if result_url:
                return result_url
            raise Exception(f"任务已完成但未找到输出: {str(poll_data)[:200]}")

        if status in ("FAILED", "FAIL", "ERROR", "CANCELED", "CANCELLED", "TIMEOUT", "REVOKED"):
            error_msg = poll_data.get("error_info") or poll_data.get("message") or poll_data.get("detail") or str(poll_data)
            raise Exception(f"任务失败: {error_msg}")


@app.post("/api/generate")
async def generate_content(payload: GeneratePayload):
    if not payload.prompt.strip():
        raise HTTPException(status_code=400, detail="请输入提示内容")
    providers = load_api_providers()
    provider = next((p for p in providers if p.get("primary")), None)
    if not provider:
        provider = providers[0] if providers else None
    if not provider:
        raise HTTPException(status_code=400, detail="请先配置API提供商")
    api_key = provider_env_key_value(provider["id"])
    if not api_key:
        raise HTTPException(status_code=400, detail="请先配置API Key")
    base_url = provider.get("base_url", "")
    if not base_url:
        raise HTTPException(status_code=400, detail="请配置API Base URL")
    model = payload.model
    if not model:
        if payload.type == "text":
            model = provider.get("chat_models", ["gpt-4"])[0] if provider.get("chat_models") else "gpt-4"
        elif payload.type == "image":
            img_list = provider.get("image_models", [])
            filtered = [m for m in img_list if "edit" not in m.lower() and "inpaint" not in m.lower()]
            model = filtered[0] if filtered else (img_list[0] if img_list else "dall-e-3")
        elif payload.type == "video":
            model = provider.get("video_models", ["sora"])[0] if provider.get("video_models") else "sora"
    try:
        protocol = detect_protocol(payload)
        result = await call_openai_compatible_api(
            base_url=base_url,
            api_key=api_key,
            model=model,
            prompt=payload.prompt,
            generate_type=payload.type,
            resolution=payload.resolution,
            aspect_ratio=payload.aspect_ratio,
            protocol=protocol,
            images=payload.images,
            videos=payload.videos,
        )
        return {"ok": True, "result": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"生成失败: {str(e)}")


async def run_canvas_task(task_id: str, payload: GeneratePayload):
    """Run a generation task in the background (image/text/video)."""
    async with CANVAS_TASK_LOCK:
        CANVAS_TASKS[task_id]["status"] = "running"
        CANVAS_TASKS[task_id]["progress"] = 10

    try:
        providers = load_api_providers()
        provider_id = payload.provider_id.strip().lower() if payload.provider_id else ""
        provider = None
        if provider_id:
            provider = next((p for p in providers if p["id"] == provider_id), None)
        if not provider:
            provider = next((p for p in providers if p.get("primary")), None)
        if not provider:
            provider = providers[0] if providers else None
        if not provider:
            raise Exception("未找到可用的API平台，请先在设置中配置")

        api_key = provider_env_key_value(provider["id"])
        if not api_key:
            raise Exception(f"API平台「{provider.get('name') or provider['id']}」未配置API Key")

        base_url = provider.get("base_url", "")
        if not base_url:
            raise Exception(f"API平台「{provider.get('name') or provider['id']}」未配置请求地址")

        model = payload.model
        if not model:
            type_map = {"text": "chat_models", "image": "image_models", "video": "video_models"}
            models_list = provider.get(type_map.get(payload.type, "chat_models"), [])
            # For image generation, skip models whose name suggests they require image input
            if payload.type == "image":
                models_list = [m for m in models_list if "edit" not in m.lower() and "inpaint" not in m.lower()]
            model = models_list[0] if models_list else ""

        protocol = provider.get("protocol", "openai") or "openai"

        async with CANVAS_TASK_LOCK:
            CANVAS_TASKS[task_id]["progress"] = 30

        result = await call_openai_compatible_api(
            base_url=base_url,
            api_key=api_key,
            model=model,
            prompt=payload.prompt,
            generate_type=payload.type,
            resolution=payload.resolution,
            aspect_ratio=payload.aspect_ratio,
            protocol=protocol,
            images=payload.images,
            videos=payload.videos,
        )

        async with CANVAS_TASK_LOCK:
            CANVAS_TASKS[task_id]["progress"] = 70

        if payload.type == "image" and result.get("url"):
            image_url = result["url"]
            ext = "png"
            if "." in image_url:
                parts = image_url.rsplit(".", 1)
                candidate = parts[-1].split("?")[0].split("#")[0][:10]
                if candidate and candidate.isalnum() and len(candidate) <= 5:
                    ext = candidate
            img_dir = os.path.join(MEDIA_DIR, "images")
            local_name = f"{task_id}.{ext}"
            local_path = os.path.join(img_dir, local_name)

            async with httpx.AsyncClient(timeout=120) as client:
                img_resp = await client.get(image_url, follow_redirects=True)
                if img_resp.status_code >= 400:
                    raise Exception(f"下载图片失败: HTTP {img_resp.status_code}")
                with open(local_path, "wb") as f:
                    f.write(img_resp.content)

            result["url"] = f"/api/media/images/{local_name}"

        elif payload.type == "image" and result.get("b64_json"):
            img_dir = os.path.join(MEDIA_DIR, "images")
            local_name = f"{task_id}.png"
            local_path = os.path.join(img_dir, local_name)
            with open(local_path, "wb") as f:
                f.write(base64.b64decode(result["b64_json"]))
            result["url"] = f"/api/media/images/{local_name}"

        elif payload.type == "text" and result.get("content"):
            texts_dir = os.path.join(MEDIA_DIR, "texts")
            local_name = f"{task_id}.txt"
            local_path = os.path.join(texts_dir, local_name)
            with open(local_path, "w", encoding="utf-8") as f:
                f.write(result["content"])
            result["url"] = f"/api/media/texts/{local_name}"

        elif payload.type == "video" and result.get("url"):
            video_url = result["url"]
            ext = "mp4"
            if "." in video_url:
                parts = video_url.rsplit(".", 1)
                candidate = parts[-1].split("?")[0].split("#")[0][:10]
                if candidate.isalnum() and len(candidate) <= 5:
                    ext = candidate
            video_dir = os.path.join(MEDIA_DIR, "videos")
            local_name = f"{task_id}.{ext}"
            local_path = os.path.join(video_dir, local_name)

            async with httpx.AsyncClient(timeout=300) as client:
                vid_resp = await client.get(video_url, follow_redirects=True)
                if vid_resp.status_code >= 400:
                    raise Exception(f"下载视频失败: HTTP {vid_resp.status_code}")
                with open(local_path, "wb") as f:
                    f.write(vid_resp.content)

            result["url"] = f"/api/media/videos/{local_name}"

        async with CANVAS_TASK_LOCK:
            CANVAS_TASKS[task_id]["status"] = "succeeded"
            CANVAS_TASKS[task_id]["progress"] = 100
            CANVAS_TASKS[task_id]["result"] = result

    except Exception as e:
        async with CANVAS_TASK_LOCK:
            CANVAS_TASKS[task_id]["status"] = "failed"
            CANVAS_TASKS[task_id]["error"] = str(e)


@app.post("/api/tasks")
async def create_task(payload: GeneratePayload):
    if not payload.prompt.strip():
        raise HTTPException(status_code=400, detail="请输入提示内容")
    task_id = f"task_{uuid.uuid4().hex}"
    task = {
        "task_id": task_id,
        "status": "queued",
        "progress": 0,
        "result": None,
        "error": None,
        "payload": payload.model_dump(),
    }
    async with CANVAS_TASK_LOCK:
        CANVAS_TASKS[task_id] = task
    asyncio.create_task(run_canvas_task(task_id, payload))
    return task


@app.get("/api/health")
async def health_check():
    return {"status": "ok"}


@app.get("/api/tasks/{task_id}")
async def get_task_status(task_id: str):
    async with CANVAS_TASK_LOCK:
        task = CANVAS_TASKS.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    return task


app.mount("/api/media", StaticFiles(directory=MEDIA_DIR), name="media")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
