use candle_core::{quantized::gguf_file, Device, Tensor};
use candle_transformers::{
    generation::LogitsProcessor, models::quantized_qwen2, utils::apply_repeat_penalty,
};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File},
    io::{BufReader, Read},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex as StdMutex,
    },
    time::{Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager, State};
use tokenizers::Tokenizer;
use tokio::{io::AsyncWriteExt, sync::Mutex as AsyncMutex};

const MAX_PROMPT_TOKENS: usize = 2048;
const DEFAULT_MAX_NEW_TOKENS: usize = 448;
const MIN_NEW_TOKENS: usize = 64;
const MAX_NEW_TOKENS: usize = 768;
const REPEAT_PENALTY: f32 = 1.12;
const REPEAT_LAST_N: usize = 64;

#[derive(Clone, Copy)]
struct ModelSpec {
    id: &'static str,
    name: &'static str,
    description: &'static str,
    recommended: bool,
    approx_bytes: u64,
    size_label: &'static str,
    ram_requirement: &'static str,
    weights_url: &'static str,
    tokenizer_url: &'static str,
}

const MODEL_SPECS: &[ModelSpec] = &[
    ModelSpec {
        id: "qwen2.5-3b",
        name: "Qwen2.5 3B Instruct (Q4_K_M)",
        description: "Рекомендуемая модель: точный разбор трат, категорий и вопросов на русском языке.",
        recommended: true,
        approx_bytes: 1_930_000_000,
        size_label: "~1.93 ГБ",
        ram_requirement: "6+ ГБ ОЗУ",
        weights_url: "https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/qwen2.5-3b-instruct-q4_k_m.gguf",
        tokenizer_url: "https://huggingface.co/Qwen/Qwen2.5-3B-Instruct/resolve/main/tokenizer.json",
    },
    ModelSpec {
        id: "qwen2.5-1.5b",
        name: "Qwen2.5 1.5B Instruct (Q4_K_M)",
        description: "Лёгкая модель: быстрее скачивается и экономит память на компактных смартфонах.",
        recommended: false,
        approx_bytes: 986_000_000,
        size_label: "~986 МБ",
        ram_requirement: "4+ ГБ ОЗУ",
        weights_url: "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf",
        tokenizer_url: "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct/resolve/main/tokenizer.json",
    },
];

fn find_spec(model_id: &str) -> Result<&'static ModelSpec, String> {
    MODEL_SPECS
        .iter()
        .find(|spec| spec.id == model_id)
        .ok_or_else(|| format!("Неизвестная модель ИИ: {model_id}"))
}

fn models_root(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("Не удалось определить папку данных приложения: {e}"))?;
    Ok(base.join("ai-models"))
}

fn model_paths(root: &Path, model_id: &str) -> (PathBuf, PathBuf, PathBuf) {
    let dir = root.join(model_id);
    let weights = dir.join("weights.gguf");
    let tokenizer = dir.join("tokenizer.json");
    (dir, weights, tokenizer)
}

fn verify_installed_files(weights: &Path, tokenizer: &Path) -> Option<u64> {
    let w_meta = fs::metadata(weights).ok()?;
    let t_meta = fs::metadata(tokenizer).ok()?;
    if w_meta.len() < 100_000_000 || t_meta.len() < 50_000 {
        return None;
    }
    let mut header = [0u8; 4];
    let mut f = File::open(weights).ok()?;
    f.read_exact(&mut header).ok()?;
    if &header != b"GGUF" {
        return None;
    }
    Some(w_meta.len() + t_meta.len())
}

struct LoadedEngine {
    model_id: String,
    model: quantized_qwen2::ModelWeights,
    tokenizer: Tokenizer,
}

pub struct AiState {
    engine: Arc<AsyncMutex<Option<LoadedEngine>>>,
    loaded_model_id: Arc<StdMutex<Option<String>>>,
    downloading_model_id: Arc<StdMutex<Option<String>>>,
    download_cancel: Arc<AtomicBool>,
    generating: Arc<AtomicBool>,
    chat_stop: Arc<AtomicBool>,
}

impl AiState {
    pub fn new() -> Self {
        Self {
            engine: Arc::new(AsyncMutex::new(None)),
            loaded_model_id: Arc::new(StdMutex::new(None)),
            downloading_model_id: Arc::new(StdMutex::new(None)),
            download_cancel: Arc::new(AtomicBool::new(false)),
            generating: Arc::new(AtomicBool::new(false)),
            chat_stop: Arc::new(AtomicBool::new(false)),
        }
    }
}

struct AtomicResetGuard {
    flag: Arc<AtomicBool>,
}

impl Drop for AtomicResetGuard {
    fn drop(&mut self) {
        self.flag.store(false, Ordering::SeqCst);
    }
}

struct MutexClearGuard {
    slot: Arc<StdMutex<Option<String>>>,
}

impl Drop for MutexClearGuard {
    fn drop(&mut self) {
        if let Ok(mut guard) = self.slot.lock() {
            *guard = None;
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelPresetInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    pub recommended: bool,
    pub approx_bytes: u64,
    pub size_label: String,
    pub ram_requirement: String,
    pub installed: bool,
    pub installed_bytes: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiStatusResponse {
    pub supported: bool,
    pub models_dir: String,
    pub active_model_id: Option<String>,
    pub loaded_model_id: Option<String>,
    pub downloading_model_id: Option<String>,
    pub generating: bool,
    pub models: Vec<ModelPresetInfo>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadProgressPayload {
    model_id: String,
    stage: &'static str,
    downloaded_bytes: u64,
    total_bytes: u64,
    percent: f32,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadDonePayload {
    model_id: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadErrorPayload {
    model_id: String,
    error: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessageInput {
    pub role: String,
    pub content: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatRequest {
    pub model_id: String,
    pub system_prompt: String,
    pub messages: Vec<ChatMessageInput>,
    pub max_tokens: Option<usize>,
    pub temperature: Option<f64>,
    pub request_id: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChatTokenPayload {
    request_id: String,
    token: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatDonePayload {
    pub request_id: String,
    pub full_text: String,
    pub aborted: bool,
    pub tokens_generated: usize,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChatErrorPayload {
    request_id: String,
    error: String,
}

fn build_status(app: &AppHandle, state: &AiState) -> Result<AiStatusResponse, String> {
    let root = models_root(app)?;
    let loaded_model_id = state
        .loaded_model_id
        .lock()
        .map_err(|_| "Внутренняя ошибка состояния ИИ".to_string())?
        .clone();
    let downloading_model_id = state
        .downloading_model_id
        .lock()
        .map_err(|_| "Внутренняя ошибка состояния загрузки ИИ".to_string())?
        .clone();
    let generating = state.generating.load(Ordering::SeqCst);

    let mut active_model_id: Option<String> = None;
    let mut models = Vec::with_capacity(MODEL_SPECS.len());

    for spec in MODEL_SPECS {
        let (_dir, weights, tokenizer) = model_paths(&root, spec.id);
        let installed_bytes = verify_installed_files(&weights, &tokenizer);
        let installed = installed_bytes.is_some();
        if installed && active_model_id.is_none() {
            active_model_id = Some(spec.id.to_string());
        }
        models.push(ModelPresetInfo {
            id: spec.id.to_string(),
            name: spec.name.to_string(),
            description: spec.description.to_string(),
            recommended: spec.recommended,
            approx_bytes: spec.approx_bytes,
            size_label: spec.size_label.to_string(),
            ram_requirement: spec.ram_requirement.to_string(),
            installed,
            installed_bytes: installed_bytes.unwrap_or(0),
        });
    }

    if let Some(ref loaded) = loaded_model_id {
        if models.iter().any(|m| &m.id == loaded && m.installed) {
            active_model_id = Some(loaded.clone());
        }
    }

    Ok(AiStatusResponse {
        supported: true,
        models_dir: root.to_string_lossy().into_owned(),
        active_model_id,
        loaded_model_id,
        downloading_model_id,
        generating,
        models,
    })
}

fn parse_content_range_total(headers: &reqwest::header::HeaderMap) -> Option<u64> {
    let raw = headers.get(reqwest::header::CONTENT_RANGE)?.to_str().ok()?;
    let (_, total_str) = raw.rsplit_once('/')?;
    total_str.trim().parse::<u64>().ok().filter(|&v| v > 0)
}

async fn stream_file(
    client: &reqwest::Client,
    url: &str,
    part_path: &Path,
    cancel: &AtomicBool,
    app: &AppHandle,
    model_id: &str,
    stage: &'static str,
    fallback_total: u64,
    emit_progress: bool,
    allow_resume: bool,
) -> Result<(), String> {
    for attempt in 0..2 {
        let existing_offset = if allow_resume {
            tokio::fs::metadata(part_path)
                .await
                .map(|m| m.len())
                .unwrap_or(0)
        } else {
            0
        };

        let mut req = client
            .get(url)
            .header(reqwest::header::ACCEPT_ENCODING, "identity");
        if existing_offset > 0 {
            req = req.header(reqwest::header::RANGE, format!("bytes={existing_offset}-"));
        }

        let response = req
            .send()
            .await
            .map_err(|e| format!("Ошибка сети при скачивании: {e}"))?;

        if response.status() == reqwest::StatusCode::RANGE_NOT_SATISFIABLE && attempt == 0 {
            let _ = tokio::fs::remove_file(part_path).await;
            continue;
        }

        if !response.status().is_success() {
            return Err(format!(
                "Сервер моделей вернул HTTP {} при загрузке.",
                response.status().as_u16()
            ));
        }

        let is_partial =
            response.status() == reqwest::StatusCode::PARTIAL_CONTENT && existing_offset > 0;
        let total_bytes = if is_partial {
            parse_content_range_total(response.headers())
                .or_else(|| response.content_length().map(|len| existing_offset + len))
                .unwrap_or(fallback_total)
                .max(1)
        } else {
            response.content_length().unwrap_or(fallback_total).max(1)
        };

        let mut file = if is_partial {
            tokio::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(part_path)
                .await
                .map_err(|e| format!("Не удалось открыть файл для докачки: {e}"))?
        } else {
            tokio::fs::File::create(part_path)
                .await
                .map_err(|e| format!("Не удалось создать файл на диске: {e}"))?
        };

        let mut stream = response.bytes_stream();
        let mut downloaded: u64 = if is_partial { existing_offset } else { 0 };
        let mut last_emit = Instant::now();
        let mut last_percent: i32 = -1;

        if emit_progress {
            let init_percent =
                ((downloaded as f64 / total_bytes as f64) * 100.0).clamp(0.0, 99.5) as f32;
            let _ = app.emit(
                "ai-download-progress",
                DownloadProgressPayload {
                    model_id: model_id.to_string(),
                    stage,
                    downloaded_bytes: downloaded,
                    total_bytes,
                    percent: init_percent,
                },
            );
        }

        while let Some(chunk_res) = stream.next().await {
            if cancel.load(Ordering::SeqCst) {
                drop(file);
                let _ = tokio::fs::remove_file(part_path).await;
                return Err("Загрузка отменена пользователем.".to_string());
            }

            let chunk = chunk_res.map_err(|e| format!("Сбой передачи данных: {e}"))?;
            file.write_all(&chunk)
                .await
                .map_err(|e| format!("Недостаточно места или ошибка записи на диск: {e}"))?;
            downloaded = downloaded.saturating_add(chunk.len() as u64);

            if emit_progress {
                let percent =
                    ((downloaded as f64 / total_bytes as f64) * 100.0).clamp(0.0, 99.5) as f32;
                let whole = percent as i32;
                if whole != last_percent || last_emit.elapsed().as_millis() >= 160 {
                    last_percent = whole;
                    last_emit = Instant::now();
                    let _ = app.emit(
                        "ai-download-progress",
                        DownloadProgressPayload {
                            model_id: model_id.to_string(),
                            stage,
                            downloaded_bytes: downloaded,
                            total_bytes,
                            percent,
                        },
                    );
                }
            }
        }

        file.flush()
            .await
            .map_err(|e| format!("Ошибка сброса буфера файла: {e}"))?;
        drop(file);

        if cancel.load(Ordering::SeqCst) {
            let _ = tokio::fs::remove_file(part_path).await;
            return Err("Загрузка отменена пользователем.".to_string());
        }

        return Ok(());
    }

    Err("Не удалось согласовать диапазон докачки с сервером.".to_string())
}

async fn run_model_download(
    app: AppHandle,
    spec: &'static ModelSpec,
    cancel: Arc<AtomicBool>,
) -> Result<(), String> {
    let root = models_root(&app)?;
    let (dir, weights_path, tokenizer_path) = model_paths(&root, spec.id);
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| format!("Не удалось создать каталог для модели: {e}"))?;

    let tokenizer_part = dir.join("tokenizer.json.part");
    let weights_part = dir.join("weights.gguf.part");
    let _ = tokio::fs::remove_file(&tokenizer_part).await;

    let client = reqwest::Client::builder()
        .user_agent("finacc/0.2.0")
        .connect_timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| format!("Не удалось инициализировать HTTP-клиент: {e}"))?;

    let tokenizer_ready = tokio::fs::metadata(&tokenizer_path)
        .await
        .map(|m| m.len() >= 50_000)
        .unwrap_or(false);

    if !tokenizer_ready {
        let _ = app.emit(
            "ai-download-progress",
            DownloadProgressPayload {
                model_id: spec.id.to_string(),
                stage: "tokenizer",
                downloaded_bytes: 0,
                total_bytes: spec.approx_bytes,
                percent: 0.0,
            },
        );

        if let Err(err) = stream_file(
            &client,
            spec.tokenizer_url,
            &tokenizer_part,
            &cancel,
            &app,
            spec.id,
            "tokenizer",
            10_000_000,
            false,
            false,
        )
        .await
        {
            let _ = tokio::fs::remove_file(&tokenizer_part).await;
            return Err(err);
        }

        let tok_meta = tokio::fs::metadata(&tokenizer_part)
            .await
            .map_err(|e| format!("Не найден временный файл токенизатора: {e}"))?;
        if tok_meta.len() < 50_000 {
            let _ = tokio::fs::remove_file(&tokenizer_part).await;
            return Err("Скачанный токенизатор повреждён или неполный.".to_string());
        }

        tokio::fs::rename(&tokenizer_part, &tokenizer_path)
            .await
            .map_err(|e| format!("Не удалось сохранить tokenizer.json: {e}"))?;
    }

    stream_file(
        &client,
        spec.weights_url,
        &weights_part,
        &cancel,
        &app,
        spec.id,
        "weights",
        spec.approx_bytes,
        true,
        true,
    )
    .await?;

    let _ = app.emit(
        "ai-download-progress",
        DownloadProgressPayload {
            model_id: spec.id.to_string(),
            stage: "verifying",
            downloaded_bytes: spec.approx_bytes,
            total_bytes: spec.approx_bytes,
            percent: 99.8,
        },
    );

    let weights_meta = tokio::fs::metadata(&weights_part)
        .await
        .map_err(|e| format!("Не найден временный файл весов модели: {e}"))?;
    if weights_meta.len() < 100_000_000 {
        let _ = tokio::fs::remove_file(&weights_part).await;
        return Err("Файл весов модели скачался не полностью.".to_string());
    }

    let mut header = [0u8; 4];
    let header_ok = {
        let mut f = File::open(&weights_part)
            .map_err(|e| format!("Не удалось проверить файл весов модели: {e}"))?;
        f.read_exact(&mut header).is_ok() && &header == b"GGUF"
    };
    if !header_ok {
        let _ = tokio::fs::remove_file(&weights_part).await;
        return Err("Скачанный файл не является корректной моделью GGUF.".to_string());
    }

    tokio::fs::rename(&weights_part, &weights_path)
        .await
        .map_err(|e| format!("Не удалось сохранить weights.gguf: {e}"))?;

    let _ = app.emit(
        "ai-download-progress",
        DownloadProgressPayload {
            model_id: spec.id.to_string(),
            stage: "verifying",
            downloaded_bytes: weights_meta.len(),
            total_bytes: weights_meta.len(),
            percent: 100.0,
        },
    );

    Ok(())
}

fn format_chatml(system_prompt: &str, messages: &[&ChatMessageInput]) -> String {
    let mut out = String::with_capacity(2048);
    out.push_str("<|im_start|>system\n");
    out.push_str(system_prompt.trim());
    out.push_str("<|im_end|>\n");

    for msg in messages {
        let role = if msg.role == "assistant" {
            "assistant"
        } else {
            "user"
        };
        out.push_str("<|im_start|>");
        out.push_str(role);
        out.push('\n');
        out.push_str(msg.content.trim());
        out.push_str("<|im_end|>\n");
    }
    out.push_str("<|im_start|>assistant\n");
    out
}

fn encode_trimmed_prompt(
    tokenizer: &Tokenizer,
    system_prompt: &str,
    messages: &[ChatMessageInput],
) -> Result<Vec<u32>, String> {
    let filtered: Vec<&ChatMessageInput> = messages
        .iter()
        .filter(|m| !m.content.trim().is_empty())
        .collect();
    if filtered.is_empty() {
        return Err("Введите вопрос для ИИ-помощника.".to_string());
    }

    let mut start_idx = 0usize;
    loop {
        let slice = &filtered[start_idx..];
        let prompt = format_chatml(system_prompt, slice);
        let enc = tokenizer
            .encode(prompt, false)
            .map_err(|e| format!("Ошибка токенизации: {e}"))?;
        let ids = enc.get_ids();
        if ids.len() <= MAX_PROMPT_TOKENS || start_idx + 1 >= filtered.len() {
            if ids.len() > MAX_PROMPT_TOKENS + 512 {
                let keep_start = ids.len() - MAX_PROMPT_TOKENS;
                return Ok(ids[keep_start..].to_vec());
            }
            return Ok(ids.to_vec());
        }
        start_idx += 1;
    }
}

fn current_seed() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(42)
}

#[tauri::command]
pub async fn ai_status(
    app: AppHandle,
    state: State<'_, AiState>,
) -> Result<AiStatusResponse, String> {
    build_status(&app, &state)
}

#[tauri::command]
pub async fn ai_install_model(
    app: AppHandle,
    state: State<'_, AiState>,
    model_id: String,
) -> Result<AiStatusResponse, String> {
    let spec = find_spec(&model_id)?;

    {
        let mut downloading = state
            .downloading_model_id
            .lock()
            .map_err(|_| "Внутренняя ошибка состояния загрузки ИИ".to_string())?;
        if let Some(ref current) = *downloading {
            return Err(format!("Сейчас уже скачивается модель {current}."));
        }
        state.download_cancel.store(false, Ordering::SeqCst);
        *downloading = Some(spec.id.to_string());
    }

    let app_bg = app.clone();
    let cancel_bg = state.download_cancel.clone();
    let slot_bg = state.downloading_model_id.clone();

    tokio::spawn(async move {
        let clear_guard = MutexClearGuard { slot: slot_bg };
        let outcome = run_model_download(app_bg.clone(), spec, cancel_bg).await;
        drop(clear_guard);
        match outcome {
            Ok(()) => {
                let _ = app_bg.emit(
                    "ai-download-done",
                    DownloadDonePayload {
                        model_id: spec.id.to_string(),
                    },
                );
            }
            Err(error) => {
                let _ = app_bg.emit(
                    "ai-download-error",
                    DownloadErrorPayload {
                        model_id: spec.id.to_string(),
                        error,
                    },
                );
            }
        }
    });

    build_status(&app, &state)
}

#[tauri::command]
pub async fn ai_cancel_install(state: State<'_, AiState>) -> Result<(), String> {
    state.download_cancel.store(true, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
pub async fn ai_unload_model(state: State<'_, AiState>) -> Result<(), String> {
    if state.generating.load(Ordering::SeqCst) {
        return Err("Сначала остановите текущий ответ ИИ.".to_string());
    }
    let mut engine = state
        .engine
        .try_lock()
        .map_err(|_| "Модель сейчас занята — дождитесь завершения ответа.".to_string())?;
    *engine = None;
    if let Ok(mut loaded) = state.loaded_model_id.lock() {
        *loaded = None;
    }
    Ok(())
}

#[tauri::command]
pub async fn ai_delete_model(
    app: AppHandle,
    state: State<'_, AiState>,
    model_id: String,
) -> Result<AiStatusResponse, String> {
    let spec = find_spec(&model_id)?;

    if let Ok(downloading) = state.downloading_model_id.lock() {
        if downloading.as_deref() == Some(spec.id) {
            return Err("Нельзя удалить модель во время скачивания — сначала отмените загрузку.".to_string());
        }
    }

    if state.generating.load(Ordering::SeqCst) {
        let is_loaded = state
            .loaded_model_id
            .lock()
            .ok()
            .and_then(|g| g.clone())
            .as_deref()
            == Some(spec.id);
        if is_loaded {
            return Err("Сначала остановите генерацию ответа перед удалением модели.".to_string());
        }
    }

    if let Ok(mut engine) = state.engine.try_lock() {
        if engine.as_ref().map(|e| e.model_id.as_str()) == Some(spec.id) {
            *engine = None;
            if let Ok(mut loaded) = state.loaded_model_id.lock() {
                *loaded = None;
            }
        }
    } else if state
        .loaded_model_id
        .lock()
        .ok()
        .and_then(|g| g.clone())
        .as_deref()
        == Some(spec.id)
    {
        return Err("Модель сейчас отвечает на запрос — сначала нажмите «Стоп».".to_string());
    }

    let root = models_root(&app)?;
    let (dir, _, _) = model_paths(&root, spec.id);
    if dir.exists() {
        fs::remove_dir_all(&dir)
            .map_err(|e| format!("Не удалось удалить файлы модели: {e}"))?;
    }

    build_status(&app, &state)
}

#[tauri::command]
pub async fn ai_stop_chat(state: State<'_, AiState>) -> Result<(), String> {
    state.chat_stop.store(true, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
pub async fn ai_chat(
    app: AppHandle,
    state: State<'_, AiState>,
    request: ChatRequest,
) -> Result<ChatDonePayload, String> {
    let spec = find_spec(&request.model_id)?;
    let root = models_root(&app)?;
    let (_dir, weights_path, tokenizer_path) = model_paths(&root, spec.id);
    if verify_installed_files(&weights_path, &tokenizer_path).is_none() {
        return Err("Выбранная модель ещё не установлена на устройство.".to_string());
    }

    if state
        .generating
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("Помощник уже отвечает на предыдущий вопрос.".to_string());
    }

    state.chat_stop.store(false, Ordering::SeqCst);

    let engine_arc = state.engine.clone();
    let loaded_slot = state.loaded_model_id.clone();
    let generating_flag = state.generating.clone();
    let stop_flag = state.chat_stop.clone();
    let app_handle = app.clone();
    let req_id_for_err = request.request_id.clone();

    let mut engine_guard = engine_arc.lock_owned().await;

    let result = tokio::task::spawn_blocking(move || -> Result<ChatDonePayload, String> {
        let _gen_guard = AtomicResetGuard {
            flag: generating_flag,
        };
        let device = Device::Cpu;

        let needs_load = engine_guard
            .as_ref()
            .map(|e| e.model_id != spec.id)
            .unwrap_or(true);

        if needs_load {
            *engine_guard = None;
            if let Ok(mut loaded) = loaded_slot.lock() {
                *loaded = None;
            }

            let tokenizer = Tokenizer::from_file(&tokenizer_path)
                .map_err(|e| format!("Не удалось загрузить токенизатор: {e}"))?;
            let file = File::open(&weights_path)
                .map_err(|e| format!("Не удалось открыть файл весов модели: {e}"))?;
            let mut reader = BufReader::new(file);
            let content = gguf_file::Content::read(&mut reader)
                .map_err(|e| format!("Повреждённый GGUF-файл модели: {e}"))?;
            let model = quantized_qwen2::ModelWeights::from_gguf(content, &mut reader, &device)
                .map_err(|e| format!("Не удалось загрузить модель в память: {e}"))?;

            *engine_guard = Some(LoadedEngine {
                model_id: spec.id.to_string(),
                model,
                tokenizer,
            });
            if let Ok(mut loaded) = loaded_slot.lock() {
                *loaded = Some(spec.id.to_string());
            }
        }

        let loaded = engine_guard
            .as_mut()
            .ok_or_else(|| "Не удалось инициализировать локальную модель.".to_string())?;

        let prompt_tokens = encode_trimmed_prompt(
            &loaded.tokenizer,
            &request.system_prompt,
            &request.messages,
        )?;
        let prompt_len = prompt_tokens.len();

        let eos_im_end = loaded.tokenizer.token_to_id("<|im_end|>");
        let eos_text = loaded.tokenizer.token_to_id("<|endoftext|>");

        let max_new_tokens = request
            .max_tokens
            .unwrap_or(DEFAULT_MAX_NEW_TOKENS)
            .clamp(MIN_NEW_TOKENS, MAX_NEW_TOKENS);
        let temperature = request.temperature.unwrap_or(0.45).clamp(0.05, 1.2);

        let mut logits_processor = LogitsProcessor::new(current_seed(), Some(temperature), Some(0.9));
        let mut all_tokens: Vec<u32> = prompt_tokens.clone();
        let mut generated_tokens: Vec<u32> = Vec::with_capacity(max_new_tokens);
        let mut emitted_bytes = 0usize;
        let mut full_text = String::new();
        let mut aborted = false;

        // `index_pos = 0` tells quantized_qwen2::ModelWeights to reset any prior KV cache.
        let prompt_tensor = Tensor::from_slice(&prompt_tokens, (1, prompt_len), &device)
            .map_err(|e| format!("Ошибка создания тензора запроса: {e}"))?;
        let mut logits = loaded
            .model
            .forward(&prompt_tensor, 0)
            .map_err(|e| format!("Ошибка обработки контекста моделью: {e}"))?
            .squeeze(0)
            .map_err(|e| format!("Ошибка формы логитов: {e}"))?;

        for step in 0..max_new_tokens {
            if stop_flag.load(Ordering::SeqCst) {
                aborted = true;
                break;
            }

            let penalty_ctx_start = all_tokens.len().saturating_sub(REPEAT_LAST_N);
            let penalized = apply_repeat_penalty(
                &logits,
                REPEAT_PENALTY,
                &all_tokens[penalty_ctx_start..],
            )
            .map_err(|e| format!("Ошибка штрафа повторов: {e}"))?;

            let next_token = logits_processor
                .sample(&penalized)
                .map_err(|e| format!("Ошибка выбора токена: {e}"))?;

            if Some(next_token) == eos_im_end || Some(next_token) == eos_text {
                break;
            }

            all_tokens.push(next_token);
            generated_tokens.push(next_token);

            if let Ok(decoded) = loaded.tokenizer.decode(&generated_tokens, true) {
                // Trim trailing replacement characters while multi-byte Cyrillic/UTF-8 tokens complete.
                let safe_slice = decoded.trim_end_matches('\u{FFFD}');
                let safe_end = safe_slice.len();
                if safe_end > emitted_bytes {
                    let delta = safe_slice[emitted_bytes..safe_end].to_string();
                    emitted_bytes = safe_end;
                    full_text.push_str(&delta);
                    let _ = app_handle.emit(
                        "ai-chat-token",
                        ChatTokenPayload {
                            request_id: request.request_id.clone(),
                            token: delta,
                        },
                    );
                }
            }

            if stop_flag.load(Ordering::SeqCst) {
                aborted = true;
                break;
            }

            if step + 1 < max_new_tokens {
                let next_tensor = Tensor::from_slice(&[next_token], (1, 1), &device)
                    .map_err(|e| format!("Ошибка создания тензора токена: {e}"))?;
                logits = loaded
                    .model
                    .forward(&next_tensor, prompt_len + step)
                    .map_err(|e| format!("Ошибка генерации токена: {e}"))?
                    .squeeze(0)
                    .map_err(|e| format!("Ошибка формы логитов: {e}"))?;
            }
        }

        if let Ok(decoded_final) = loaded.tokenizer.decode(&generated_tokens, true) {
            if decoded_final.len() > emitted_bytes {
                let tail = decoded_final[emitted_bytes..].replace('\u{FFFD}', "");
                if !tail.is_empty() {
                    full_text.push_str(&tail);
                    let _ = app_handle.emit(
                        "ai-chat-token",
                        ChatTokenPayload {
                            request_id: request.request_id.clone(),
                            token: tail,
                        },
                    );
                }
            }
        }

        let payload = ChatDonePayload {
            request_id: request.request_id,
            full_text,
            aborted,
            tokens_generated: generated_tokens.len(),
        };
        let _ = app_handle.emit("ai-chat-done", payload.clone());
        Ok(payload)
    })
    .await
    .map_err(|e| format!("Сбой фонового потока ИИ: {e}"))?;

    if let Err(ref err) = result {
        let _ = app.emit(
            "ai-chat-error",
            ChatErrorPayload {
                request_id: req_id_for_err,
                error: err.clone(),
            },
        );
    }

    result
}
