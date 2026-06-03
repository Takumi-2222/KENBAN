use base64::{engine::general_purpose::STANDARD, Engine};
use image::imageops::FilterType;
use image::{DynamicImage, GenericImageView, ImageBuffer, Rgba, RgbaImage};
use psd::Psd;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::collections::{HashMap, VecDeque};
use std::fs;
use std::hash::{Hash, Hasher};
use std::io::{Cursor, Write};
use std::panic;
use std::path::{Path, PathBuf};
use std::collections::HashSet;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_fs::FsExt;

const JSON_FOLDER_BASE_PATH: &str = r"G:\共有ドライブ\CLLENN\編集部フォルダ\編集企画部\編集企画_C班(AT業務推進)\DTP制作部\JSONフォルダ";
const JSON_ACCESS_LOG_BASE_PATH: &str =
    r"G:\共有ドライブ\CLLENN\編集部フォルダ\編集企画部\編集企画_C班(AT業務推進)\DTP制作部\JSON_Log";

// ============== セキュリティ: セッション許可リスト（Phase 2 最小特権） ==============
// Renderer から渡された任意のパス文字列をそのまま使うのではなく、
// 「信頼できる入口」(OSダイアログ / 実D&D / CLI / 固定業務フォルダ) を通過した
// パスだけをセッション中の許可リストへ登録し、利用系コマンドは canonicalize 後に
// 許可リストと照合する。未登録パスは存在有無に関わらず FORBIDDEN_PATH を返す。
const FORBIDDEN: &str = "FORBIDDEN_PATH";

struct AllowList {
    files: Mutex<HashSet<PathBuf>>, // 個別に許可された実体ファイル
    dirs: Mutex<HashSet<PathBuf>>,  // 再帰的に許可された実体ディレクトリ
}

static ALLOWLIST: OnceLock<AllowList> = OnceLock::new();

fn allowlist() -> &'static AllowList {
    ALLOWLIST.get_or_init(|| AllowList {
        files: Mutex::new(HashSet::new()),
        dirs: Mutex::new(HashSet::new()),
    })
}

/// 信頼できる入口で得たファイルをセッション許可リストへ登録（fs プラグインの実行時スコープも開放）
fn register_allowed_file(app: &AppHandle, raw: &str) {
    // フロントが送ってくる「そのままの文字列」と canonical の両方を fs scope に許可
    let _ = app.fs_scope().allow_file(raw);
    if let Ok(c) = std::fs::canonicalize(raw) {
        let _ = app.fs_scope().allow_file(&c);
        if let Ok(mut set) = allowlist().files.lock() {
            set.insert(c);
        }
    }
}

/// 信頼できる入口で得たフォルダを再帰的にセッション許可リストへ登録
fn register_allowed_dir(app: &AppHandle, raw: &str) {
    let _ = app.fs_scope().allow_directory(raw, true);
    if let Ok(c) = std::fs::canonicalize(raw) {
        let _ = app.fs_scope().allow_directory(&c, true);
        if let Ok(mut set) = allowlist().dirs.lock() {
            set.insert(c);
        }
    }
}

/// canonical 済みパスが許可リスト（ファイル一致 or 許可ディレクトリ配下）に含まれるか
fn is_within_allowed(c: &Path) -> bool {
    if let Ok(files) = allowlist().files.lock() {
        if files.contains(c) {
            return true;
        }
    }
    if let Ok(dirs) = allowlist().dirs.lock() {
        if dirs.iter().any(|d| c.starts_with(d)) {
            return true;
        }
    }
    false
}

/// 読み取り・列挙用: 実体パスへ解決してから許可判定。未許可は一律 FORBIDDEN_PATH。
fn ensure_allowed_read(path: &str) -> Result<(), String> {
    let c = std::fs::canonicalize(path).map_err(|_| FORBIDDEN.to_string())?;
    if is_within_allowed(&c) {
        Ok(())
    } else {
        Err(FORBIDDEN.to_string())
    }
}

/// 書き込み・新規作成用: ファイル自体が未存在でも親ディレクトリを実体パス解決して判定。
fn ensure_allowed_write(path: &str) -> Result<(), String> {
    let p = Path::new(path);
    let resolved = match std::fs::canonicalize(p) {
        Ok(c) => c,
        Err(_) => {
            let parent = p.parent().ok_or_else(|| FORBIDDEN.to_string())?;
            let file_name = p.file_name().ok_or_else(|| FORBIDDEN.to_string())?;
            let cp = std::fs::canonicalize(parent).map_err(|_| FORBIDDEN.to_string())?;
            cp.join(file_name)
        }
    };
    if is_within_allowed(&resolved) {
        Ok(())
    } else {
        Err(FORBIDDEN.to_string())
    }
}

/// 保存ファイル名の厳格検証（標準設計ガイドライン 5.3）
fn validate_file_name(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("invalid file name: empty".into());
    }
    if name != name.trim() {
        return Err("invalid file name: leading/trailing whitespace".into());
    }
    if name.ends_with('.') {
        return Err("invalid file name: trailing dot".into());
    }
    if name.contains('/') || name.contains('\\') {
        return Err("invalid file name: path separator".into());
    }
    if name.contains("..") {
        return Err("invalid file name: traversal".into());
    }
    if name.chars().any(|ch| (ch as u32) < 0x20) {
        return Err("invalid file name: control character".into());
    }
    if name
        .chars()
        .any(|ch| matches!(ch, ':' | '*' | '?' | '"' | '<' | '>' | '|'))
    {
        return Err("invalid file name: forbidden character".into());
    }
    let stem = name.split('.').next().unwrap_or("").to_ascii_uppercase();
    const RESERVED: &[&str] = &[
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
        "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    if RESERVED.contains(&stem.as_str()) {
        return Err("invalid file name: reserved name".into());
    }
    Ok(())
}

/// 起動引数や固定業務フォルダなど、信頼できる初期パスを許可リストへ登録
fn seed_trusted_roots(app: &AppHandle) {
    // アプリ専用 Temp（プレビュー/差分の出力先）
    if let Ok(temp) = get_kenban_temp_dir() {
        register_allowed_dir(app, &temp.to_string_lossy());
    }
    // 固定業務フォルダ（JSON 共有ドライブ）と保存先デスクトップフォルダ
    register_allowed_dir(app, JSON_FOLDER_BASE_PATH);
    register_allowed_dir(app, JSON_ACCESS_LOG_BASE_PATH);
    if let Some(desktop) = dirs::desktop_dir() {
        let out = desktop.join("Script_Output");
        let _ = fs::create_dir_all(&out);
        register_allowed_dir(app, &out.to_string_lossy());
    }
    // CLI 引数で渡された実在パス（選択JSON・フォルダ）。CLI はユーザー/自動化由来の信頼入口。
    for arg in std::env::args().skip(1) {
        let p = Path::new(&arg);
        if p.is_dir() {
            register_allowed_dir(app, &arg);
        } else if p.is_file() {
            register_allowed_file(app, &arg);
        }
    }
}

/// 起動可能な外部 exe のパスを検証（任意実行ファイルの起動による RCE を防止）。
/// Renderer から渡せるのは「想定された実行ファイル名と一致する実在 exe」のみ。
fn validate_executable(path: &str, expected_lower_names: &[&str]) -> Result<PathBuf, String> {
    let p = PathBuf::from(path);
    let name = p
        .file_name()
        .and_then(|n| n.to_str())
        .map(|n| n.to_ascii_lowercase())
        .ok_or_else(|| "invalid executable path".to_string())?;
    if !expected_lower_names.contains(&name.as_str()) {
        return Err(format!("forbidden executable: {}", name));
    }
    if !p.exists() {
        return Err(format!("executable not found: {}", p.display()));
    }
    Ok(p)
}

// ============== セキュリティ用コマンド: 信頼できる入口（OSダイアログ） ==============

#[derive(Deserialize)]
struct DialogFilter {
    name: String,
    extensions: Vec<String>,
}

/// OSファイル選択ダイアログ（Rust側で開く信頼入口）。選択結果をセッション許可リストへ登録して返す。
#[tauri::command]
async fn pick_files(
    app: AppHandle,
    multiple: bool,
    filters: Vec<DialogFilter>,
) -> Result<Vec<String>, String> {
    let app2 = app.clone();
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut builder = app2.dialog().file();
        for f in &filters {
            let exts: Vec<&str> = f.extensions.iter().map(|s| s.as_str()).collect();
            builder = builder.add_filter(f.name.as_str(), &exts);
        }
        let result: Vec<String> = if multiple {
            builder
                .blocking_pick_files()
                .unwrap_or_default()
                .into_iter()
                .map(|p| p.to_string())
                .collect()
        } else {
            builder
                .blocking_pick_file()
                .map(|p| vec![p.to_string()])
                .unwrap_or_default()
        };
        let _ = tx.send(result);
    });
    let paths = rx.recv().map_err(|e| e.to_string())?;
    for p in &paths {
        register_allowed_file(&app, p);
    }
    Ok(paths)
}

/// OS保存ダイアログ（Rust側で開く信頼入口）。保存先を書き込み許可へ登録して返す。
#[tauri::command]
async fn pick_save_file(
    app: AppHandle,
    default_name: Option<String>,
    filters: Vec<DialogFilter>,
) -> Result<Option<String>, String> {
    let app2 = app.clone();
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut builder = app2.dialog().file();
        for f in &filters {
            let exts: Vec<&str> = f.extensions.iter().map(|s| s.as_str()).collect();
            builder = builder.add_filter(f.name.as_str(), &exts);
        }
        if let Some(name) = default_name {
            builder = builder.set_file_name(name);
        }
        let path = builder.blocking_save_file().map(|p| p.to_string());
        let _ = tx.send(path);
    });
    let path = rx.recv().map_err(|e| e.to_string())?;
    if let Some(ref p) = path {
        register_allowed_file(&app, p);
    }
    Ok(path)
}

/// OSフォルダ選択ダイアログ（Rust側で開く信頼入口）。選択フォルダを再帰許可して返す。
#[tauri::command]
async fn pick_folder(app: AppHandle) -> Result<Option<String>, String> {
    let app2 = app.clone();
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let folder = app2
            .dialog()
            .file()
            .blocking_pick_folder()
            .map(|p| p.to_string());
        let _ = tx.send(folder);
    });
    let folder = rx.recv().map_err(|e| e.to_string())?;
    if let Some(ref f) = folder {
        register_allowed_dir(&app, f);
    }
    Ok(folder)
}

// ============== 画像キャッシュ ==============
struct CachedImage {
    file_path: String, // temp JPEG ファイルパス
    width: u32,
    height: u32,
    original_width: u32,
    original_height: u32,
}

struct ImageCache {
    cache: HashMap<String, CachedImage>,
    order: VecDeque<String>,
    max_size: usize,
}

impl ImageCache {
    fn new(max_size: usize) -> Self {
        Self {
            cache: HashMap::new(),
            order: VecDeque::new(),
            max_size,
        }
    }

    fn get(&self, key: &str) -> Option<&CachedImage> {
        self.cache.get(key)
    }

    fn insert(&mut self, key: String, image: CachedImage) {
        // LRUキャッシュ: 古いものを削除
        if self.cache.len() >= self.max_size {
            if let Some(oldest) = self.order.pop_front() {
                self.cache.remove(&oldest);
            }
        }
        self.order.push_back(key.clone());
        self.cache.insert(key, image);
    }

    fn clear(&mut self) {
        self.cache.clear();
        self.order.clear();
    }
}

// グローバルキャッシュ（Mutexで保護）
struct AppState {
    image_cache: Mutex<ImageCache>,
    cli_args: Vec<String>,
}

// ============== tempファイルヘルパー ==============

/// キャッシュキーからハッシュベースのファイル名を生成
fn cache_key_to_filename(cache_key: &str) -> String {
    let mut hasher = DefaultHasher::new();
    cache_key.hash(&mut hasher);
    let hash = hasher.finish();
    format!("kenban_preview_{:016x}.jpg", hash)
}

fn versioned_path_key(path: &str) -> String {
    match fs::metadata(path) {
        Ok(metadata) => {
            let len = metadata.len();
            let modified = metadata
                .modified()
                .ok()
                .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|duration| duration.as_nanos())
                .unwrap_or(0);
            format!("{}:{}:{}", path, len, modified)
        }
        Err(_) => path.to_string(),
    }
}

/// temp ディレクトリ内の kenban_preview サブフォルダを取得（なければ作成）
fn get_kenban_temp_dir() -> Result<PathBuf, String> {
    let temp = std::env::temp_dir().join("kenban_preview");
    if !temp.exists() {
        fs::create_dir_all(&temp).map_err(|e| format!("Failed to create temp dir: {}", e))?;
    }
    Ok(temp)
}

/// DynamicImage を JPEG 85% で temp ファイルに書き出し、パスを返す
/// 既にファイルが存在すればスキップ（ディスクキャッシュヒット）
fn write_image_to_temp(img: &DynamicImage, cache_key: &str) -> Result<(String, u32, u32), String> {
    let temp_dir = get_kenban_temp_dir()?;
    let filename = cache_key_to_filename(cache_key);
    let file_path = temp_dir.join(&filename);

    let (w, h) = img.dimensions();

    // 既にファイルが存在すればスキップ
    if file_path.exists() {
        return Ok((file_path.to_string_lossy().to_string(), w, h));
    }

    // RGBA → RGB 変換して JPEG エンコード
    let rgb_img = DynamicImage::ImageRgb8(img.to_rgb8());
    let mut jpeg_data = Cursor::new(Vec::new());
    rgb_img
        .write_to(&mut jpeg_data, image::ImageFormat::Jpeg)
        .map_err(|e| format!("Failed to encode JPEG: {}", e))?;

    // アトミック書き込み（一時ファイル→リネーム）
    let tmp_path = temp_dir.join(format!("{}.tmp", filename));
    fs::write(&tmp_path, jpeg_data.get_ref())
        .map_err(|e| format!("Failed to write temp file: {}", e))?;
    fs::rename(&tmp_path, &file_path).map_err(|e| format!("Failed to rename temp file: {}", e))?;

    Ok((file_path.to_string_lossy().to_string(), w, h))
}

// ============== 画像処理結果 ==============
#[derive(Serialize)]
struct ImageResult {
    file_url: String, // temp JPEG ファイルパス（フロントでasset://に変換）
    width: u32,
    height: u32,
    original_width: u32,
    original_height: u32,
}

// PSD解析結果
#[derive(Serialize)]
struct PsdImageResult {
    file_url: String, // temp JPEG ファイルパス
    width: u32,
    height: u32,
}

// PSDファイルをパースしてtemp JPEGに書き出し、パスを返す
// フォールバックパーサー（Image Data Section直接読み取り）を優先し、
// 失敗時のみpsd crateにフォールオーバー
#[tauri::command]
fn parse_psd(path: String) -> Result<PsdImageResult, String> {
    ensure_allowed_read(&path)?;
    let cache_key = format!("psd_v2:{}", versioned_path_key(&path));

    // ディスクキャッシュチェック
    let temp_dir = get_kenban_temp_dir()?;
    let filename = cache_key_to_filename(&cache_key);
    let file_path = temp_dir.join(&filename);
    if file_path.exists() {
        let (w, h) = image::image_dimensions(&file_path)
            .map_err(|e| format!("Failed to read image dimensions: {}", e))?;
        return Ok(PsdImageResult {
            file_url: file_path.to_string_lossy().to_string(),
            width: w,
            height: h,
        });
    }

    let bytes = fs::read(&path).map_err(|e| format!("Failed to read file: {}", e))?;

    let img = decode_psd_robust(&bytes)?;
    drop(bytes);

    let (file_path_str, w, h) = write_image_to_temp(&img, &cache_key)?;
    Ok(PsdImageResult {
        file_url: file_path_str,
        width: w,
        height: h,
    })
}

// ファイルをシステムのデフォルトアプリで開く
#[tauri::command]
fn open_file_with_default_app(path: String) -> Result<(), String> {
    ensure_allowed_read(&path)?;
    open::that(&path).map_err(|e| format!("Failed to open file: {}", e))
}

fn find_photoshop_path() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    let add_adobe_candidates = |base: &Path, out: &mut Vec<PathBuf>| {
        let adobe_dir = base.join("Adobe");
        if let Ok(entries) = std::fs::read_dir(&adobe_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_dir() {
                    continue;
                }

                let name = entry.file_name().to_string_lossy().to_lowercase();
                if name.contains("photoshop") {
                    out.push(path.join("Photoshop.exe"));
                }
            }
        }
    };

    if let Ok(program_files) = std::env::var("ProgramFiles") {
        add_adobe_candidates(Path::new(&program_files), &mut candidates);
    }

    if let Ok(program_files_x86) = std::env::var("ProgramFiles(x86)") {
        add_adobe_candidates(Path::new(&program_files_x86), &mut candidates);
    }

    if let Some(local_app_data) = dirs::data_local_dir() {
        candidates.push(
            local_app_data
                .join("Programs")
                .join("Adobe")
                .join("Adobe Photoshop")
                .join("Photoshop.exe"),
        );
    }

    for path in candidates {
        if path.exists() {
            return Some(path);
        }
    }

    None
}

#[tauri::command]
fn open_file_in_photoshop(path: String, photoshop_path: Option<String>) -> Result<(), String> {
    ensure_allowed_read(&path)?;
    let photoshop_path = match photoshop_path.filter(|p| !p.trim().is_empty()) {
        // Renderer 由来の exe パスは「Photoshop.exe」に限定して実在検証（任意exe起動の防止）
        Some(user) => validate_executable(&user, &["photoshop.exe"])?,
        None => find_photoshop_path().ok_or_else(|| {
            "Photoshop.exe が見つかりません。設定から Photoshop.exe を選択してください。"
                .to_string()
        })?,
    };

    if !photoshop_path.exists() {
        return Err(format!(
            "指定された Photoshop.exe が存在しません: {}",
            photoshop_path.display()
        ));
    }

    std::process::Command::new(&photoshop_path)
        .arg(&path)
        .spawn()
        .map_err(|e| format!("Failed to launch Photoshop: {}", e))?;

    Ok(())
}

// COMIC-Bridge の comic-bridge.exe を探す
fn find_comic_bridge_path() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Some(local_app_data) = dirs::data_local_dir() {
        candidates.push(
            local_app_data
                .join("Comic-Bridge")
                .join("comic-bridge.exe"),
        );
        candidates.push(
            local_app_data
                .join("Programs")
                .join("Comic-Bridge")
                .join("comic-bridge.exe"),
        );
    }

    if let Ok(program_files) = std::env::var("ProgramFiles") {
        candidates.push(
            PathBuf::from(&program_files)
                .join("Comic-Bridge")
                .join("comic-bridge.exe"),
        );
    }

    if let Ok(program_files_x86) = std::env::var("ProgramFiles(x86)") {
        candidates.push(
            PathBuf::from(&program_files_x86)
                .join("Comic-Bridge")
                .join("comic-bridge.exe"),
        );
    }

    for path in candidates {
        if path.exists() {
            return Some(path);
        }
    }

    None
}

#[tauri::command]
fn open_file_in_comic_bridge(
    path: String,
    comic_bridge_path: Option<String>,
) -> Result<(), String> {
    ensure_allowed_read(&path)?;
    let exe_path = match comic_bridge_path.filter(|p| !p.trim().is_empty()) {
        Some(user) => validate_executable(&user, &["comic-bridge.exe"])?,
        None => find_comic_bridge_path().ok_or_else(|| {
            "comic-bridge.exe が見つかりません。設定から comic-bridge.exe を選択してください。"
                .to_string()
        })?,
    };

    if !exe_path.exists() {
        return Err(format!(
            "指定された comic-bridge.exe が存在しません: {}",
            exe_path.display()
        ));
    }

    std::process::Command::new(&exe_path)
        .arg("--shashoku")
        .arg(&path)
        .spawn()
        .map_err(|e| format!("Failed to launch COMIC-Bridge: {}", e))?;

    Ok(())
}

// スクリーンショット保存結果
#[derive(Serialize)]
struct SaveScreenshotResult {
    file_path: String,
    folder_path: String,
}

// スクリーンショットを保存
#[tauri::command]
fn save_screenshot(image_data: String, file_name: String) -> Result<SaveScreenshotResult, String> {
    // デスクトップパスを取得
    let desktop = dirs::desktop_dir().ok_or_else(|| "Failed to get desktop path".to_string())?;

    // 保存先フォルダを作成
    let folder_path = desktop.join("Script_Output").join("検版ツール");
    fs::create_dir_all(&folder_path).map_err(|e| format!("Failed to create folder: {}", e))?;

    // ファイル名を生成（拡張子を.pngに変更）
    let base_name = PathBuf::from(&file_name)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "screenshot".to_string());
    validate_file_name(&base_name)?;

    // 重複回避のためタイムスタンプを追加
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let final_name = format!("{}_{}.png", base_name, timestamp);
    let file_path = folder_path.join(&final_name);

    // Base64デコード（data:image/png;base64, プレフィックスを除去）
    let base64_data = image_data
        .strip_prefix("data:image/png;base64,")
        .unwrap_or(&image_data);
    let image_bytes = STANDARD
        .decode(base64_data)
        .map_err(|e| format!("Failed to decode base64: {}", e))?;

    // ファイルに保存
    fs::write(&file_path, image_bytes).map_err(|e| format!("Failed to write file: {}", e))?;

    Ok(SaveScreenshotResult {
        file_path: file_path.to_string_lossy().to_string(),
        folder_path: folder_path.to_string_lossy().to_string(),
    })
}

// フォルダをエクスプローラーで開く
#[tauri::command]
fn open_folder(path: String) -> Result<(), String> {
    // 許可ディレクトリ配下、または「許可済みファイルを含むフォルダ」のみ Explorer で開ける
    let c = std::fs::canonicalize(&path).map_err(|_| FORBIDDEN.to_string())?;
    let allowed = is_within_allowed(&c)
        || allowlist()
            .files
            .lock()
            .map(|files| files.iter().any(|f| f.starts_with(&c)))
            .unwrap_or(false);
    if !allowed {
        return Err(FORBIDDEN.to_string());
    }
    open::that(&path).map_err(|e| format!("Failed to open folder: {}", e))
}

// MojiQのパスを探す
fn find_mojiq_path() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    // 1. Program Files
    if let Ok(program_files) = std::env::var("ProgramFiles") {
        candidates.push(
            PathBuf::from(&program_files)
                .join("MojiQ")
                .join("MojiQ.exe"),
        );
    }

    // 2. Program Files (x86)
    if let Ok(program_files_x86) = std::env::var("ProgramFiles(x86)") {
        candidates.push(
            PathBuf::from(&program_files_x86)
                .join("MojiQ")
                .join("MojiQ.exe"),
        );
    }

    // 3. ユーザーのLocalAppData\Programs（Electronのデフォルト）
    if let Some(local_app_data) = dirs::data_local_dir() {
        candidates.push(
            local_app_data
                .join("Programs")
                .join("MojiQ")
                .join("MojiQ.exe"),
        );
        candidates.push(
            local_app_data
                .join("Programs")
                .join("mojiq")
                .join("MojiQ.exe"),
        );
    }

    // 4. デスクトップ > MojiQ（開発用）
    if let Some(desktop) = dirs::desktop_dir() {
        candidates.push(
            desktop
                .join("MojiQ")
                .join("dist")
                .join("win-unpacked")
                .join("MojiQ.exe"),
        );
        // バージョン付きフォルダ（ver_X.XX\MojiQ）もスキャン
        if let Ok(entries) = std::fs::read_dir(&desktop) {
            for entry in entries.flatten() {
                let name = entry.file_name();
                let name_str = name.to_string_lossy();
                if name_str.starts_with("ver_") {
                    candidates.push(
                        entry
                            .path()
                            .join("MojiQ")
                            .join("dist")
                            .join("win-unpacked")
                            .join("MojiQ.exe"),
                    );
                }
            }
        }
    }

    // 最初に見つかったパスを返す
    for path in candidates {
        if path.exists() {
            return Some(path);
        }
    }

    None
}

// MojiQでPDFを開く（ページ指定付き）
#[tauri::command]
fn open_pdf_in_mojiq(pdf_path: String, page: Option<u32>) -> Result<(), String> {
    ensure_allowed_read(&pdf_path)?;
    println!(
        "[MojiQ] open_pdf_in_mojiq called: pdf_path={}, page={:?}",
        pdf_path, page
    );

    // MojiQ.exeのパスを探す
    let mojiq_path = find_mojiq_path().ok_or_else(|| {
        "MojiQ.exe が見つかりません。MojiQをインストールしてください。".to_string()
    })?;

    println!("[MojiQ] Found MojiQ at: {:?}", mojiq_path);

    let mut cmd = std::process::Command::new(&mojiq_path);

    if let Some(p) = page {
        cmd.arg("--page");
        cmd.arg(p.to_string());
    }
    cmd.arg(&pdf_path);

    cmd.spawn()
        .map_err(|e| format!("Failed to launch MojiQ: {}", e))?;

    Ok(())
}

// ============== 並列ビューモード用の高速画像処理 ==============

// 画像をリサイズして temp JPEG に書き出し、パスを返す（内部ヘルパー）
fn resize_and_write_to_temp(
    img: &DynamicImage,
    max_width: u32,
    max_height: u32,
    cache_key: &str,
) -> Result<(String, u32, u32), String> {
    let (orig_w, orig_h) = img.dimensions();

    // アスペクト比を保ちながらリサイズ
    let scale_w = max_width as f64 / orig_w as f64;
    let scale_h = max_height as f64 / orig_h as f64;
    let scale = scale_w.min(scale_h).min(1.0); // 拡大はしない

    if scale < 1.0 {
        let new_w = (orig_w as f64 * scale).round() as u32;
        let new_h = (orig_h as f64 * scale).round() as u32;
        let resized = img.resize(new_w, new_h, FilterType::Triangle);
        write_image_to_temp(&resized, cache_key)
    } else {
        write_image_to_temp(img, cache_key)
    }
}

// TIFF/PNG/JPG画像をデコード+リサイズして返す（3層キャッシュ: メモリ→ディスク→生成）
#[tauri::command]
fn decode_and_resize_image(
    state: State<'_, AppState>,
    path: String,
    max_width: u32,
    max_height: u32,
) -> Result<ImageResult, String> {
    ensure_allowed_read(&path)?;
    let cache_key = format!("{}:{}x{}", versioned_path_key(&path), max_width, max_height);

    // 1. メモリキャッシュチェック
    {
        let cache = state.image_cache.lock().map_err(|e| e.to_string())?;
        if let Some(cached) = cache.get(&cache_key) {
            // ファイルがまだ存在するか確認
            if PathBuf::from(&cached.file_path).exists() {
                return Ok(ImageResult {
                    file_url: cached.file_path.clone(),
                    width: cached.width,
                    height: cached.height,
                    original_width: cached.original_width,
                    original_height: cached.original_height,
                });
            }
            // ファイルが消えていたらキャッシュを無効化（下で再生成）
        }
    }

    // 2. ディスクキャッシュチェック（tempファイル存在確認）
    let temp_dir = get_kenban_temp_dir()?;
    let filename = cache_key_to_filename(&cache_key);
    let file_path = temp_dir.join(&filename);
    if file_path.exists() {
        // ディスクにあるがメモリにない → 画像サイズだけ取得してメモリキャッシュ登録
        // サイズ情報は元画像から取得する必要があるが、軽量化のためJPEGヘッダから取得
        let (w, h) = image::image_dimensions(&file_path)
            .map_err(|e| format!("Failed to read image dimensions: {}", e))?;
        let file_path_str = file_path.to_string_lossy().to_string();

        // 元画像サイズも取得
        let (orig_w, orig_h) = image::image_dimensions(&path).unwrap_or((w, h));

        let mut cache = state.image_cache.lock().map_err(|e| e.to_string())?;
        cache.insert(
            cache_key.clone(),
            CachedImage {
                file_path: file_path_str.clone(),
                width: w,
                height: h,
                original_width: orig_w,
                original_height: orig_h,
            },
        );
        return Ok(ImageResult {
            file_url: file_path_str,
            width: w,
            height: h,
            original_width: orig_w,
            original_height: orig_h,
        });
    }

    // 3. フルデコード → temp書き出し → キャッシュ登録
    let img = image::open(&path).map_err(|e| format!("Failed to open image: {}", e))?;
    let (orig_w, orig_h) = img.dimensions();

    let (file_path_str, new_w, new_h) =
        resize_and_write_to_temp(&img, max_width, max_height, &cache_key)?;

    let mut cache = state.image_cache.lock().map_err(|e| e.to_string())?;
    cache.insert(
        cache_key,
        CachedImage {
            file_path: file_path_str.clone(),
            width: new_w,
            height: new_h,
            original_width: orig_w,
            original_height: orig_h,
        },
    );

    Ok(ImageResult {
        file_url: file_path_str,
        width: new_w,
        height: new_h,
        original_width: orig_w,
        original_height: orig_h,
    })
}

// 複数画像を先読み（バックグラウンドでキャッシュ）- rayon並列化版
#[tauri::command]
async fn preload_images(
    state: State<'_, AppState>,
    paths: Vec<String>,
    max_width: u32,
    max_height: u32,
) -> Result<Vec<String>, String> {
    // 未許可パスを除外（信頼できる入口を通過したパスのみプリロード）
    let paths: Vec<String> = paths
        .into_iter()
        .filter(|p| ensure_allowed_read(p).is_ok())
        .collect();
    // 既にメモリキャッシュにあるパスを除外
    let paths_to_load: Vec<String> = {
        let cache = state.image_cache.lock().map_err(|e| e.to_string())?;
        paths
            .into_iter()
            .filter(|path| {
                let cache_key =
                    format!("{}:{}x{}", versioned_path_key(path), max_width, max_height);
                cache.get(&cache_key).is_none()
            })
            .collect()
    };

    if paths_to_load.is_empty() {
        return Ok(vec!["all cached".to_string()]);
    }

    // rayonで並列に画像を読み込み・リサイズ → tempファイルに書き出し
    let loaded: Vec<(String, Result<(String, u32, u32, u32, u32), String>)> = paths_to_load
        .par_iter()
        .map(|path| {
            let cache_key = format!("{}:{}x{}", versioned_path_key(path), max_width, max_height);

            // ディスクキャッシュチェック
            if let Ok(temp_dir) = get_kenban_temp_dir() {
                let filename = cache_key_to_filename(&cache_key);
                let file_path = temp_dir.join(&filename);
                if file_path.exists() {
                    if let Ok((w, h)) = image::image_dimensions(&file_path) {
                        let (orig_w, orig_h) =
                            image::image_dimensions(path.as_str()).unwrap_or((w, h));
                        return (
                            path.clone(),
                            Ok((
                                file_path.to_string_lossy().to_string(),
                                w,
                                h,
                                orig_w,
                                orig_h,
                            )),
                        );
                    }
                }
            }

            let result = image::open(path)
                .map_err(|e| format!("open error: {}", e))
                .and_then(|img| {
                    let (orig_w, orig_h) = img.dimensions();
                    let (file_path_str, new_w, new_h) =
                        resize_and_write_to_temp(&img, max_width, max_height, &cache_key)?;
                    Ok((file_path_str, new_w, new_h, orig_w, orig_h))
                });
            (path.clone(), result)
        })
        .collect();

    // キャッシュに一括登録
    let mut results = Vec::new();
    {
        let mut cache = state.image_cache.lock().map_err(|e| e.to_string())?;
        for (path, result) in loaded {
            let cache_key = format!("{}:{}x{}", versioned_path_key(&path), max_width, max_height);
            match result {
                Ok((file_path_str, new_w, new_h, orig_w, orig_h)) => {
                    cache.insert(
                        cache_key,
                        CachedImage {
                            file_path: file_path_str,
                            width: new_w,
                            height: new_h,
                            original_width: orig_w,
                            original_height: orig_h,
                        },
                    );
                    results.push(format!("loaded:{}", path));
                }
                Err(e) => results.push(format!("error:{}:{}", path, e)),
            }
        }
    }

    Ok(results)
}

// キャッシュクリア
#[tauri::command]
fn clear_image_cache(state: State<'_, AppState>) -> Result<(), String> {
    let mut cache = state.image_cache.lock().map_err(|e| e.to_string())?;
    cache.clear();
    Ok(())
}

// tempフォルダのプレビューファイルをクリーンアップ（1時間以上前のファイルを削除）
#[tauri::command]
fn cleanup_preview_cache() -> Result<u32, String> {
    let temp_dir = get_kenban_temp_dir()?;
    let now = std::time::SystemTime::now();
    let one_hour = std::time::Duration::from_secs(3600);
    let mut deleted = 0u32;

    if let Ok(entries) = fs::read_dir(&temp_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
            // jpg, png, tmp すべてを対象（diff画像のPNGや書き込み途中のtmpも含む）
            if matches!(ext, "jpg" | "png" | "tmp") {
                if let Ok(metadata) = path.metadata() {
                    if let Ok(modified) = metadata.modified() {
                        if let Ok(age) = now.duration_since(modified) {
                            if age > one_hour {
                                let _ = fs::remove_file(&path);
                                deleted += 1;
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(deleted)
}

// フォルダ内のファイル一覧を取得
#[tauri::command]
fn list_files_in_folder(path: String, extensions: Vec<String>) -> Result<Vec<String>, String> {
    ensure_allowed_read(&path)?;
    let dir = std::fs::read_dir(&path).map_err(|e| format!("Failed to read directory: {}", e))?;

    let mut files: Vec<String> = dir
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| {
            let path = entry.path();
            if path.is_file() {
                let ext = path
                    .extension()
                    .and_then(|e| e.to_str())
                    .map(|e| e.to_lowercase())
                    .unwrap_or_default();
                if extensions.iter().any(|e| e.to_lowercase() == ext) {
                    return path.to_str().map(|s| s.to_string());
                }
            }
            None
        })
        .collect();

    // 自然順ソート（ファイル名でソート）
    files.sort_by(|a, b| {
        let name_a = PathBuf::from(a)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_lowercase();
        let name_b = PathBuf::from(b)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_lowercase();
        natord::compare(&name_a, &name_b)
    });

    Ok(files)
}

// ============== 差分計算 ==============

#[derive(Deserialize)]
struct CropBounds {
    left: u32,
    top: u32,
    right: u32,
    bottom: u32,
}

#[derive(Serialize, Clone)]
struct DiffMarker {
    x: f64,
    y: f64,
    radius: f64,
    count: u32,
}

#[derive(Serialize)]
struct DiffSimpleResult {
    src_a: String,
    src_b: String,
    diff_src: String,
    has_diff: bool,
    diff_count: u32,
    markers: Vec<DiffMarker>,
    image_width: u32,
    image_height: u32,
}

// Phase1用: 画像エンコードなしの軽量チェック結果
#[derive(Serialize)]
struct DiffCheckSimpleResult {
    has_diff: bool,
    diff_count: u32,
    markers: Vec<DiffMarker>,
    image_width: u32,
    image_height: u32,
}

#[derive(Serialize)]
struct DiffCheckHeatmapResult {
    has_diff: bool,
    diff_probability: f64,
    high_density_count: u32,
    markers: Vec<DiffMarker>,
    image_width: u32,
    image_height: u32,
}

#[derive(Serialize)]
struct DiffHeatmapResult {
    src_a: String,
    src_b: String,
    processed_a: String,
    diff_src: String,
    has_diff: bool,
    diff_probability: f64,
    high_density_count: u32,
    markers: Vec<DiffMarker>,
    image_width: u32,
    image_height: u32,
}

// panicメッセージを文字列として抽出
#[allow(dead_code)]
fn extract_panic_message(panic_info: &Box<dyn std::any::Any + Send>) -> String {
    if let Some(s) = panic_info.downcast_ref::<&str>() {
        s.to_string()
    } else if let Some(s) = panic_info.downcast_ref::<String>() {
        s.clone()
    } else {
        "Unknown error in PSD decoder".to_string()
    }
}

// ============== フォールバックPSDパーサー ==============
// psd crateがZIP圧縮等でpanicする場合に使用する軽量パーサー。
/// psd crate出力の簡易検証（大半が黒/透明でないか）
fn is_image_valid(img: &DynamicImage) -> bool {
    let rgba = img.to_rgba8();
    let pixels = rgba.as_raw();
    let total = (rgba.width() * rgba.height()) as usize;
    if total == 0 {
        return false;
    }

    let step = (total / 500).max(1);
    let mut non_black: usize = 0;
    for i in (0..total).step_by(step) {
        let idx = i * 4;
        if idx + 2 < pixels.len() && (pixels[idx] > 0 || pixels[idx + 1] > 0 || pixels[idx + 2] > 0)
        {
            non_black += 1;
        }
    }
    let sampled = (total / step).max(1);
    non_black * 100 / sampled > 3 // 3%以上が非黒なら有効
}

/// PSD解析の堅牢ラッパー: フォールバックパーサーを優先し、失敗時のみpsd crateを使用
fn decode_psd_robust(bytes: &[u8]) -> Result<DynamicImage, String> {
    // 1. フォールバックパーサーを優先（Image Data Sectionを直接読む — 最も信頼性が高い）
    if let Ok(img) = decode_psd_fallback(bytes) {
        return Ok(img);
    }

    // 2. フォールバック失敗時はpsd crateを試行
    let result = panic::catch_unwind(panic::AssertUnwindSafe(|| {
        let psd = Psd::from_bytes(bytes).map_err(|e| format!("Failed to parse PSD: {}", e))?;
        let width = psd.width();
        let height = psd.height();
        let rgba = psd.rgba();
        let img_buf: ImageBuffer<Rgba<u8>, Vec<u8>> = ImageBuffer::from_raw(width, height, rgba)
            .ok_or_else(|| "Failed to create image buffer".to_string())?;
        Ok::<DynamicImage, String>(DynamicImage::ImageRgba8(img_buf))
    }));

    match result {
        Ok(Ok(img)) if is_image_valid(&img) => Ok(img),
        Ok(Ok(_)) => Err(
            "PSD画像のデコード結果が不正です（画像データが破損している可能性があります）"
                .to_string(),
        ),
        Ok(Err(e)) => Err(e),
        Err(_) => Err("PSD解析中にエラーが発生しました".to_string()),
    }
}

// PSDの合成画像(Image Data Section)のみを読み取る。レイヤー合成は行わない。
// RLE圧縮・非圧縮・CMYK/RGBカラーモードに対応。

/// PSDバイト列からRGBA DynamicImageをデコード（フォールバック用）
fn decode_psd_fallback(bytes: &[u8]) -> Result<DynamicImage, String> {
    if bytes.len() < 26 {
        return Err("PSD file too small".to_string());
    }
    // シグネチャ検証
    if &bytes[0..4] != b"8BPS" {
        return Err("Not a PSD file".to_string());
    }
    let version = u16::from_be_bytes([bytes[4], bytes[5]]);
    let is_psb = version == 2;
    if version != 1 && version != 2 {
        return Err(format!("Unsupported PSD version: {}", version));
    }

    let mut offset: usize = 12;

    // ファイルヘッダー
    let channels = read_u16(bytes, &mut offset)? as usize;
    let height = read_u32(bytes, &mut offset)? as usize;
    let width = read_u32(bytes, &mut offset)? as usize;
    let depth = read_u16(bytes, &mut offset)?;
    let color_mode = read_u16(bytes, &mut offset)?;

    if depth != 8 && !(color_mode == 0 && depth == 1) {
        return Err(format!(
            "フォールバックパーサーは{}bit深度に未対応です",
            depth
        ));
    }

    // Color Mode Data セクションをスキップ
    let color_data_len = read_u32(bytes, &mut offset)? as usize;
    let color_data_start = offset;
    offset += color_data_len;
    if offset > bytes.len() {
        return Err("PSD data truncated (color mode data)".to_string());
    }
    let color_data = &bytes[color_data_start..offset];

    // Image Resources セクションをスキップ
    let resource_len = read_u32(bytes, &mut offset)? as usize;
    offset += resource_len;

    // Layer and Mask Information セクションをスキップ
    let layer_len = if is_psb {
        read_u64(bytes, &mut offset)? as usize
    } else {
        read_u32(bytes, &mut offset)? as usize
    };
    offset += layer_len;

    // Image Data Section
    let compression = read_u16(bytes, &mut offset)?;
    if color_mode == 0 && depth == 1 {
        return decode_psd_bitmap_image_data(
            bytes,
            offset,
            width,
            height,
            channels,
            compression,
            is_psb,
        );
    }

    let ch_to_read = match color_mode {
        1 | 2 | 7 | 8 => channels.min(1),
        3 | 9 => channels.min(3),
        4 => channels.min(4),
        _ => {
            return Err(format!(
                "Unsupported PSD color mode in fallback parser (color_mode={})",
                color_mode
            ));
        }
    };
    let pixel_count = width * height;
    if ch_to_read == 0 {
        return Err("PSD has no readable channels".to_string());
    }

    let channel_data: Vec<Vec<u8>> = match compression {
        0 => {
            // 非圧縮 (Raw)
            let mut chs = Vec::with_capacity(ch_to_read);
            for c in 0..channels {
                if c < ch_to_read {
                    if offset + pixel_count > bytes.len() {
                        return Err("PSD data truncated (raw channel)".to_string());
                    }
                    chs.push(bytes[offset..offset + pixel_count].to_vec());
                }
                offset += pixel_count;
            }
            chs
        }
        1 => {
            // RLE圧縮
            // 各スキャンラインのバイト数を読み取り
            let total_rows = channels * height;
            if offset + total_rows * 2 > bytes.len() {
                return Err("PSD data truncated (RLE row counts)".to_string());
            }
            let mut row_counts = Vec::with_capacity(total_rows);
            for _ in 0..total_rows {
                row_counts.push(read_u16(bytes, &mut offset)? as usize);
            }

            let mut chs = Vec::with_capacity(ch_to_read);
            let mut row_idx = 0;
            for c in 0..channels {
                if c < ch_to_read {
                    let mut ch_data = vec![0u8; pixel_count];
                    let mut pixel_off = 0;
                    for _ in 0..height {
                        let row_len = row_counts[row_idx];
                        row_idx += 1;
                        if offset + row_len > bytes.len() {
                            return Err("PSD data truncated (RLE data)".to_string());
                        }
                        decode_packbits(bytes, offset, row_len, &mut ch_data, pixel_off, width);
                        offset += row_len;
                        pixel_off += width;
                    }
                    chs.push(ch_data);
                } else {
                    for _ in 0..height {
                        offset += row_counts[row_idx];
                        row_idx += 1;
                    }
                }
            }
            chs
        }
        _ => {
            return Err(format!(
                "未対応の圧縮方式です (compression={})",
                compression
            ));
        }
    };

    // RGBA画像を組み立て
    let mut rgba = vec![0u8; pixel_count * 4];

    match color_mode {
        1 | 7 | 8 => {
            let gray = &channel_data[0];
            for i in 0..pixel_count {
                let j = i * 4;
                rgba[j] = gray[i];
                rgba[j + 1] = gray[i];
                rgba[j + 2] = gray[i];
                rgba[j + 3] = 255;
            }
        }
        2 => {
            if color_data.len() < 768 {
                return Err("Indexed PSD palette is missing or truncated".to_string());
            }
            let index_ch = &channel_data[0];
            for i in 0..pixel_count {
                let palette_index = index_ch[i] as usize;
                let j = i * 4;
                rgba[j] = color_data[palette_index];
                rgba[j + 1] = color_data[256 + palette_index];
                rgba[j + 2] = color_data[512 + palette_index];
                rgba[j + 3] = 255;
            }
        }
        3 => {
            let r = &channel_data[0];
            let g = &channel_data[1.min(channel_data.len() - 1)];
            let b = &channel_data[2.min(channel_data.len() - 1)];
            for i in 0..pixel_count {
                let j = i * 4;
                rgba[j] = r[i];
                rgba[j + 1] = g[i];
                rgba[j + 2] = b[i];
                rgba[j + 3] = 255;
            }
        }
        4 => {
            let c_ch = &channel_data[0];
            let m_ch = &channel_data[1.min(channel_data.len() - 1)];
            let y_ch = &channel_data[2.min(channel_data.len() - 1)];
            let k_ch = &channel_data[3.min(channel_data.len() - 1)];
            for i in 0..pixel_count {
                let j = i * 4;
                let (c, m, y, k) = (
                    c_ch[i] as u16,
                    m_ch[i] as u16,
                    y_ch[i] as u16,
                    k_ch[i] as u16,
                );
                rgba[j] = 255 - ((c + k).min(255) as u8);
                rgba[j + 1] = 255 - ((m + k).min(255) as u8);
                rgba[j + 2] = 255 - ((y + k).min(255) as u8);
                rgba[j + 3] = 255;
            }
        }
        9 => {
            let l_ch = &channel_data[0];
            let a_ch = &channel_data[1.min(channel_data.len() - 1)];
            let b_ch = &channel_data[2.min(channel_data.len() - 1)];
            for i in 0..pixel_count {
                let j = i * 4;
                let (r, g, b) = lab_to_srgb(l_ch[i], a_ch[i], b_ch[i]);
                rgba[j] = r;
                rgba[j + 1] = g;
                rgba[j + 2] = b;
                rgba[j + 3] = 255;
            }
        }
        _ => unreachable!("unsupported PSD color mode should be rejected before decode"),
    }

    let img_buf: ImageBuffer<Rgba<u8>, Vec<u8>> =
        ImageBuffer::from_raw(width as u32, height as u32, rgba)
            .ok_or_else(|| "Failed to create image buffer (fallback)".to_string())?;
    Ok(DynamicImage::ImageRgba8(img_buf))
}

fn lab_to_srgb(l_byte: u8, a_byte: u8, b_byte: u8) -> (u8, u8, u8) {
    let l = (l_byte as f32) * 100.0 / 255.0;
    let a = (a_byte as f32) - 128.0;
    let b = (b_byte as f32) - 128.0;

    let fy = (l + 16.0) / 116.0;
    let fx = fy + a / 500.0;
    let fz = fy - b / 200.0;

    fn lab_f_inv(t: f32) -> f32 {
        let t3 = t * t * t;
        if t3 > 0.008856 {
            t3
        } else {
            (t - 16.0 / 116.0) / 7.787
        }
    }

    let x = 0.9642 * lab_f_inv(fx);
    let y = lab_f_inv(fy);
    let z = 0.8251 * lab_f_inv(fz);

    let x_d65 = 0.9555766 * x - 0.0230393 * y + 0.0631636 * z;
    let y_d65 = -0.0282895 * x + 1.0099416 * y + 0.0210077 * z;
    let z_d65 = 0.0122982 * x - 0.0204830 * y + 1.3299098 * z;

    let r = 3.2404542 * x_d65 - 1.5371385 * y_d65 - 0.4985314 * z_d65;
    let g = -0.9692660 * x_d65 + 1.8760108 * y_d65 + 0.0415560 * z_d65;
    let blue = 0.0556434 * x_d65 - 0.2040259 * y_d65 + 1.0572252 * z_d65;

    (
        linear_to_srgb_u8(r),
        linear_to_srgb_u8(g),
        linear_to_srgb_u8(blue),
    )
}

fn linear_to_srgb_u8(v: f32) -> u8 {
    let v = v.clamp(0.0, 1.0);
    let srgb = if v <= 0.0031308 {
        12.92 * v
    } else {
        1.055 * v.powf(1.0 / 2.4) - 0.055
    };
    (srgb * 255.0).round().clamp(0.0, 255.0) as u8
}

fn decode_psd_bitmap_image_data(
    bytes: &[u8],
    mut offset: usize,
    width: usize,
    height: usize,
    channels: usize,
    compression: u16,
    is_psb: bool,
) -> Result<DynamicImage, String> {
    if channels == 0 {
        return Err("Bitmap PSD has no channels".to_string());
    }

    let row_bytes = (width + 7) / 8;
    let bitmap = match compression {
        0 => {
            if offset + row_bytes * height > bytes.len() {
                return Err("PSD data truncated (bitmap raw data)".to_string());
            }
            bytes[offset..offset + row_bytes * height].to_vec()
        }
        1 => {
            let total_rows = channels * height;
            let count_size = if is_psb { 4 } else { 2 };
            if offset + total_rows * count_size > bytes.len() {
                return Err("PSD data truncated (bitmap RLE row counts)".to_string());
            }

            let mut row_counts = Vec::with_capacity(total_rows);
            for _ in 0..total_rows {
                let row_len = if is_psb {
                    read_u32(bytes, &mut offset)? as usize
                } else {
                    read_u16(bytes, &mut offset)? as usize
                };
                row_counts.push(row_len);
            }

            let mut decoded = vec![0u8; row_bytes * height];
            let mut row_idx = 0;
            for c in 0..channels {
                for y in 0..height {
                    let row_len = row_counts[row_idx];
                    row_idx += 1;
                    if offset + row_len > bytes.len() {
                        return Err("PSD data truncated (bitmap RLE data)".to_string());
                    }
                    if c == 0 {
                        decode_packbits(
                            bytes,
                            offset,
                            row_len,
                            &mut decoded,
                            y * row_bytes,
                            row_bytes,
                        );
                    }
                    offset += row_len;
                }
            }
            decoded
        }
        _ => {
            return Err(format!(
                "Unsupported Bitmap PSD compression (compression={})",
                compression
            ));
        }
    };

    let mut rgba = vec![255u8; width * height * 4];
    for y in 0..height {
        for x in 0..width {
            let byte = bitmap[y * row_bytes + x / 8];
            let bit = (byte >> (7 - (x % 8))) & 1;
            let value = if bit == 1 { 0 } else { 255 };
            let j = (y * width + x) * 4;
            rgba[j] = value;
            rgba[j + 1] = value;
            rgba[j + 2] = value;
            rgba[j + 3] = 255;
        }
    }

    let img_buf: ImageBuffer<Rgba<u8>, Vec<u8>> =
        ImageBuffer::from_raw(width as u32, height as u32, rgba)
            .ok_or_else(|| "Failed to create image buffer (bitmap PSD fallback)".to_string())?;
    Ok(DynamicImage::ImageRgba8(img_buf))
}

// PackBits (RLE) デコード
fn decode_packbits(
    src: &[u8],
    src_start: usize,
    src_len: usize,
    dst: &mut [u8],
    dst_start: usize,
    dst_len: usize,
) {
    let mut s = src_start;
    let mut d = dst_start;
    let src_end = src_start + src_len;
    let dst_end = dst_start + dst_len;
    while d < dst_end && s < src_end {
        let n = src[s] as i8;
        s += 1;
        if n >= 0 {
            // リテラルコピー: n+1 バイト
            let count = (n as usize) + 1;
            let end = (d + count).min(dst_end);
            while d < end && s < src_end {
                dst[d] = src[s];
                d += 1;
                s += 1;
            }
        } else if n > -128 {
            // 繰り返し: 1-n 回
            let count = (1 - n as i16) as usize;
            if s >= src_end {
                break;
            }
            let val = src[s];
            s += 1;
            let end = (d + count).min(dst_end);
            while d < end {
                dst[d] = val;
                d += 1;
            }
        }
        // n == -128 はNOP
    }
}

// バイト読み取りヘルパー
fn read_u16(bytes: &[u8], offset: &mut usize) -> Result<u16, String> {
    if *offset + 2 > bytes.len() {
        return Err("PSD data truncated (u16)".to_string());
    }
    let val = u16::from_be_bytes([bytes[*offset], bytes[*offset + 1]]);
    *offset += 2;
    Ok(val)
}

fn read_u32(bytes: &[u8], offset: &mut usize) -> Result<u32, String> {
    if *offset + 4 > bytes.len() {
        return Err("PSD data truncated (u32)".to_string());
    }
    let val = u32::from_be_bytes([
        bytes[*offset],
        bytes[*offset + 1],
        bytes[*offset + 2],
        bytes[*offset + 3],
    ]);
    *offset += 4;
    Ok(val)
}

fn read_u64(bytes: &[u8], offset: &mut usize) -> Result<u64, String> {
    if *offset + 8 > bytes.len() {
        return Err("PSD data truncated (u64)".to_string());
    }
    let val = u64::from_be_bytes([
        bytes[*offset],
        bytes[*offset + 1],
        bytes[*offset + 2],
        bytes[*offset + 3],
        bytes[*offset + 4],
        bytes[*offset + 5],
        bytes[*offset + 6],
        bytes[*offset + 7],
    ]);
    *offset += 8;
    Ok(val)
}

// 拡張子でPSD/TIFF/その他を自動判定してデコード
fn decode_image_file(path: &str) -> Result<DynamicImage, String> {
    let lower = path.to_lowercase();
    if lower.ends_with(".psd") {
        decode_psd_to_image(path)
    } else {
        image::open(path).map_err(|e| format!("Failed to open image {}: {}", path, e))
    }
}

// PSDファイルをDynamicImageとしてデコード
// フォールバックパーサー（Image Data Section直読み）を優先し、失敗時のみpsd crateを使用
fn decode_psd_to_image(path: &str) -> Result<DynamicImage, String> {
    let bytes = fs::read(path).map_err(|e| format!("Failed to read PSD: {}", e))?;
    decode_psd_robust(&bytes)
}

// PSD デコード結果のプロセス内キャッシュ。
// 多ページPDFとの照合で同じPSDを何十回もデコードする無駄を避ける。
// 容量は2エントリのみ（最近使ったPSD 2件を保持）。
struct PsdCacheEntry {
    path: String,
    mtime: u64,
    image: Arc<DynamicImage>,
}

static PSD_DECODE_CACHE: OnceLock<Mutex<Vec<PsdCacheEntry>>> = OnceLock::new();
const PSD_CACHE_CAPACITY: usize = 2;

fn psd_decode_cache_storage() -> &'static Mutex<Vec<PsdCacheEntry>> {
    PSD_DECODE_CACHE.get_or_init(|| Mutex::new(Vec::new()))
}

fn get_file_mtime_secs(path: &str) -> u64 {
    fs::metadata(path)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// PSD をデコードして Arc<DynamicImage> を返す。同じ (path, mtime) なら内部キャッシュをヒット。
fn decode_psd_cached(path: &str) -> Result<Arc<DynamicImage>, String> {
    let mtime = get_file_mtime_secs(path);
    let cache = psd_decode_cache_storage();

    // ヒット確認
    {
        let guard = cache.lock().unwrap();
        for entry in guard.iter() {
            if entry.path == path && entry.mtime == mtime {
                return Ok(Arc::clone(&entry.image));
            }
        }
    }

    // ミス: デコードして格納
    let img = decode_psd_to_image(path)?;
    let arc = Arc::new(img);
    {
        let mut guard = cache.lock().unwrap();
        // 同じ path の古いエントリは削除（mtime更新時の差し替え）
        guard.retain(|e| e.path != path);
        // 容量超過時は古い順にエビクト
        while guard.len() >= PSD_CACHE_CAPACITY {
            guard.remove(0);
        }
        guard.push(PsdCacheEntry {
            path: path.to_string(),
            mtime,
            image: Arc::clone(&arc),
        });
    }
    Ok(arc)
}

// DynamicImageをJPEG 85%でtempファイルに書き出し、パスを返す（高速エンコード＋IPC転送不要）
fn encode_to_jpeg_temp(img: &DynamicImage, cache_key: &str) -> Result<String, String> {
    let temp_dir = get_kenban_temp_dir()?;
    let filename = {
        let mut hasher = DefaultHasher::new();
        cache_key.hash(&mut hasher);
        format!("kenban_diff_{:016x}.jpg", hasher.finish())
    };
    let file_path = temp_dir.join(&filename);

    if file_path.exists() {
        return Ok(file_path.to_string_lossy().to_string());
    }

    let rgb = img.to_rgb8();
    let tmp_path = temp_dir.join(format!("{}.tmp", filename));
    let file =
        fs::File::create(&tmp_path).map_err(|e| format!("Failed to create temp file: {}", e))?;
    let encoder =
        image::codecs::jpeg::JpegEncoder::new_with_quality(std::io::BufWriter::new(file), 85);
    rgb.write_with_encoder(encoder)
        .map_err(|e| format!("JPEG encode error: {}", e))?;
    fs::rename(&tmp_path, &file_path).map_err(|e| format!("Failed to rename temp file: {}", e))?;

    Ok(file_path.to_string_lossy().to_string())
}

// RGBAバッファをPNGでtempファイルに書き出し、パスを返す（差分画像用）
fn encode_rgba_to_png_temp(
    buf: &[u8],
    width: u32,
    height: u32,
    cache_key: &str,
) -> Result<String, String> {
    let temp_dir = get_kenban_temp_dir()?;
    let filename = {
        let mut hasher = DefaultHasher::new();
        cache_key.hash(&mut hasher);
        format!("kenban_diff_{:016x}.png", hasher.finish())
    };
    let file_path = temp_dir.join(&filename);

    if file_path.exists() {
        return Ok(file_path.to_string_lossy().to_string());
    }

    let img: ImageBuffer<Rgba<u8>, &[u8]> = ImageBuffer::from_raw(width, height, buf)
        .ok_or_else(|| "Failed to create image buffer".to_string())?;
    let tmp_path = temp_dir.join(format!("{}.tmp", filename));
    let file =
        fs::File::create(&tmp_path).map_err(|e| format!("Failed to create temp file: {}", e))?;
    img.write_to(&mut std::io::BufWriter::new(file), image::ImageFormat::Png)
        .map_err(|e| format!("PNG encode error: {}", e))?;
    fs::rename(&tmp_path, &file_path).map_err(|e| format!("Failed to rename temp file: {}", e))?;

    Ok(file_path.to_string_lossy().to_string())
}

struct DiffPixel {
    x: u32,
    y: u32,
}

// ピクセル単位の単純差分計算 (rayon行並列)
// 返り値: (差分RGBAバッファ, 差分ピクセル数, 差分ピクセル座標リスト)
fn diff_simple_core(
    a: &[u8],
    b: &[u8],
    width: u32,
    height: u32,
    threshold: u8,
) -> (Vec<u8>, u32, Vec<DiffPixel>) {
    let threshold = threshold as i16;
    let row_size = (width as usize) * 4;

    // 行ごとに並列処理
    let rows: Vec<(Vec<u8>, u32, Vec<DiffPixel>)> = (0..height)
        .into_par_iter()
        .map(|y| {
            let offset = (y as usize) * row_size;
            let row_a = &a[offset..offset + row_size];
            let row_b = &b[offset..offset + row_size];
            let mut row_buf = vec![0u8; row_size];
            let mut count = 0u32;
            let mut pixels = Vec::new();

            for x in 0..width as usize {
                let i = x * 4;
                let dr = (row_a[i] as i16 - row_b[i] as i16).abs();
                let dg = (row_a[i + 1] as i16 - row_b[i + 1] as i16).abs();
                let db = (row_a[i + 2] as i16 - row_b[i + 2] as i16).abs();

                if dr > threshold || dg > threshold || db > threshold {
                    row_buf[i] = 255; // R
                    row_buf[i + 1] = 0; // G
                    row_buf[i + 2] = 0; // B
                    row_buf[i + 3] = 255; // A
                    count += 1;
                    pixels.push(DiffPixel { x: x as u32, y });
                } else {
                    // 黒背景（alpha=255）
                    row_buf[i + 3] = 255;
                }
            }
            (row_buf, count, pixels)
        })
        .collect();

    let total_size = (width as usize) * (height as usize) * 4;
    let mut diff_buf = vec![0u8; total_size];
    let mut total_count = 0u32;
    let mut all_pixels = Vec::new();

    for (y, (row_buf, count, pixels)) in rows.into_iter().enumerate() {
        let offset = y * row_size;
        diff_buf[offset..offset + row_size].copy_from_slice(&row_buf);
        total_count += count;
        all_pixels.extend(pixels);
    }

    (diff_buf, total_count, all_pixels)
}

// ヒートマップ差分計算（積分画像→密度マップ→着色）
fn diff_heatmap_core(
    a: &[u8],
    b: &[u8],
    width: u32,
    height: u32,
    threshold: u8,
) -> (Vec<u8>, u32, Vec<DiffPixel>) {
    let w = width as usize;
    let h = height as usize;
    let threshold = threshold as i16;

    // Phase 1: diffMask作成（rayon並列）
    let diff_mask: Vec<u8> = (0..h)
        .into_par_iter()
        .flat_map(|y| {
            let offset = y * w * 4;
            (0..w)
                .map(move |x| {
                    let i = offset + x * 4;
                    let dr = (a[i] as i16 - b[i] as i16).abs();
                    let dg = (a[i + 1] as i16 - b[i + 1] as i16).abs();
                    let db = (a[i + 2] as i16 - b[i + 2] as i16).abs();
                    if dr > threshold || dg > threshold || db > threshold {
                        1u8
                    } else {
                        0u8
                    }
                })
                .collect::<Vec<_>>()
        })
        .collect();

    // Phase 2: 積分画像（sequential - データ依存あり）
    let iw = w + 1;
    let ih = h + 1;
    let mut integral = vec![0f32; iw * ih];
    for y in 0..h {
        for x in 0..w {
            let idx = (y + 1) * iw + (x + 1);
            integral[idx] = diff_mask[y * w + x] as f32 + integral[idx - 1] + integral[idx - iw]
                - integral[idx - iw - 1];
        }
    }

    // Phase 3: 密度マップ（rayon並列 - integralは読み取り専用）
    let radius: i32 = 15;
    let density_and_max: Vec<(f32, f32)> = (0..h)
        .into_par_iter()
        .map(|y| {
            let mut row_max = 0f32;
            let row: Vec<f32> = (0..w)
                .map(|x| {
                    let x1 = (x as i32 - radius).max(0) as usize;
                    let y1 = (y as i32 - radius).max(0) as usize;
                    let x2 = ((x as i32 + radius) as usize).min(w - 1);
                    let y2 = ((y as i32 + radius) as usize).min(h - 1);
                    let area = ((x2 - x1 + 1) * (y2 - y1 + 1)) as f32;
                    let sum = integral[(y2 + 1) * iw + (x2 + 1)]
                        - integral[y1 * iw + (x2 + 1)]
                        - integral[(y2 + 1) * iw + x1]
                        + integral[y1 * iw + x1];
                    let d = sum / area;
                    if d > row_max {
                        row_max = d;
                    }
                    d
                })
                .collect();
            // rowとrow_maxをタプルで返す（後でflatten）
            row.into_iter()
                .map(move |d| (d, row_max))
                .collect::<Vec<_>>()
        })
        .flatten()
        .collect();

    // maxDensityを求める
    let max_density = density_and_max.iter().map(|(_, m)| *m).fold(0f32, f32::max);

    // Phase 4: ヒートマップ着色 + 高密度ピクセル収集（rayon並列）
    let density_threshold = 0.05f32;
    let rows: Vec<(Vec<u8>, u32, Vec<DiffPixel>)> = (0..h)
        .into_par_iter()
        .map(|y| {
            let row_size = w * 4;
            let mut row_buf = vec![0u8; row_size];
            let mut high_count = 0u32;
            let mut high_pixels = Vec::new();

            for x in 0..w {
                let pixel_idx = y * w + x;
                let di = x * 4;
                let (density, _) = density_and_max[pixel_idx];
                let normalized = if max_density > 0.0 {
                    density / max_density
                } else {
                    0.0
                };

                if diff_mask[pixel_idx] == 1 && density > density_threshold {
                    let (r, g, b) = if normalized < 0.3 {
                        (0u8, (normalized / 0.3 * 200.0) as u8, 200u8)
                    } else if normalized < 0.6 {
                        let t = (normalized - 0.3) / 0.3;
                        (
                            (t * 255.0) as u8,
                            (200.0 + t * 55.0) as u8,
                            ((1.0 - t) * 200.0) as u8,
                        )
                    } else {
                        let t = (normalized - 0.6) / 0.4;
                        high_count += 1;
                        high_pixels.push(DiffPixel {
                            x: x as u32,
                            y: y as u32,
                        });
                        (255u8, ((1.0 - t) * 255.0) as u8, 0u8)
                    };
                    row_buf[di] = r;
                    row_buf[di + 1] = g;
                    row_buf[di + 2] = b;
                    row_buf[di + 3] = 255;
                } else {
                    // 黒背景
                    row_buf[di + 3] = 255;
                }
            }
            (row_buf, high_count, high_pixels)
        })
        .collect();

    let total_size = w * h * 4;
    let mut heatmap_buf = vec![0u8; total_size];
    let mut total_high = 0u32;
    let mut all_high_pixels = Vec::new();

    for (y, (row_buf, count, pixels)) in rows.into_iter().enumerate() {
        let offset = y * w * 4;
        heatmap_buf[offset..offset + w * 4].copy_from_slice(&row_buf);
        total_high += count;
        all_high_pixels.extend(pixels);
    }

    (heatmap_buf, total_high, all_high_pixels)
}

// マスク付きヒートマップ差分計算 — mask が 0 の領域は完全に無視する
// color-mono モード: モノクロ側の濃い部分（黒インク・トーン）だけを比較対象にして、
// 紙の白部分や淡いトーンを無視することで、カラー側との実質的な不一致だけを検出する
fn diff_heatmap_core_masked(
    a: &[u8],
    b: &[u8],
    mask: &[u8], // 長さ = width * height、1=対象 / 0=無視
    width: u32,
    height: u32,
    threshold: u8,
) -> (Vec<u8>, u32, Vec<DiffPixel>) {
    let w = width as usize;
    let h = height as usize;
    let threshold = threshold as i16;

    // Phase 1: diffMask作成（mask=0なら問答無用で 0）
    let diff_mask: Vec<u8> = (0..h)
        .into_par_iter()
        .flat_map(|y| {
            let offset = y * w * 4;
            (0..w)
                .map(move |x| {
                    let m_idx = y * w + x;
                    if mask[m_idx] == 0 {
                        return 0u8;
                    }
                    let i = offset + x * 4;
                    let dr = (a[i] as i16 - b[i] as i16).abs();
                    let dg = (a[i + 1] as i16 - b[i + 1] as i16).abs();
                    let db = (a[i + 2] as i16 - b[i + 2] as i16).abs();
                    if dr > threshold || dg > threshold || db > threshold {
                        1u8
                    } else {
                        0u8
                    }
                })
                .collect::<Vec<_>>()
        })
        .collect();

    // Phase 2: 積分画像
    let iw = w + 1;
    let ih = h + 1;
    let mut integral = vec![0f32; iw * ih];
    for y in 0..h {
        for x in 0..w {
            let idx = (y + 1) * iw + (x + 1);
            integral[idx] = diff_mask[y * w + x] as f32 + integral[idx - 1] + integral[idx - iw]
                - integral[idx - iw - 1];
        }
    }

    // Phase 3: 密度マップ
    let radius: i32 = 15;
    let density_and_max: Vec<(f32, f32)> = (0..h)
        .into_par_iter()
        .map(|y| {
            let mut row_max = 0f32;
            let row: Vec<f32> = (0..w)
                .map(|x| {
                    let x1 = (x as i32 - radius).max(0) as usize;
                    let y1 = (y as i32 - radius).max(0) as usize;
                    let x2 = ((x as i32 + radius) as usize).min(w - 1);
                    let y2 = ((y as i32 + radius) as usize).min(h - 1);
                    let area = ((x2 - x1 + 1) * (y2 - y1 + 1)) as f32;
                    let sum = integral[(y2 + 1) * iw + (x2 + 1)]
                        - integral[y1 * iw + (x2 + 1)]
                        - integral[(y2 + 1) * iw + x1]
                        + integral[y1 * iw + x1];
                    let d = sum / area;
                    if d > row_max {
                        row_max = d;
                    }
                    d
                })
                .collect();
            row.into_iter()
                .map(move |d| (d, row_max))
                .collect::<Vec<_>>()
        })
        .flatten()
        .collect();

    let max_density = density_and_max.iter().map(|(_, m)| *m).fold(0f32, f32::max);

    // Phase 4: ヒートマップ着色 + 高密度ピクセル収集
    let density_threshold = 0.05f32;
    let rows: Vec<(Vec<u8>, u32, Vec<DiffPixel>)> = (0..h)
        .into_par_iter()
        .map(|y| {
            let row_size = w * 4;
            let mut row_buf = vec![0u8; row_size];
            let mut high_count = 0u32;
            let mut high_pixels = Vec::new();

            for x in 0..w {
                let pixel_idx = y * w + x;
                let di = x * 4;
                let (density, _) = density_and_max[pixel_idx];
                let normalized = if max_density > 0.0 {
                    density / max_density
                } else {
                    0.0
                };

                if diff_mask[pixel_idx] == 1 && density > density_threshold {
                    let (r, g, b) = if normalized < 0.3 {
                        (0u8, (normalized / 0.3 * 200.0) as u8, 200u8)
                    } else if normalized < 0.6 {
                        let t = (normalized - 0.3) / 0.3;
                        (
                            (t * 255.0) as u8,
                            (200.0 + t * 55.0) as u8,
                            ((1.0 - t) * 200.0) as u8,
                        )
                    } else {
                        let t = (normalized - 0.6) / 0.4;
                        high_count += 1;
                        high_pixels.push(DiffPixel {
                            x: x as u32,
                            y: y as u32,
                        });
                        (255u8, ((1.0 - t) * 255.0) as u8, 0u8)
                    };
                    row_buf[di] = r;
                    row_buf[di + 1] = g;
                    row_buf[di + 2] = b;
                    row_buf[di + 3] = 255;
                } else {
                    row_buf[di + 3] = 255;
                }
            }
            (row_buf, high_count, high_pixels)
        })
        .collect();

    let total_size = w * h * 4;
    let mut heatmap_buf = vec![0u8; total_size];
    let mut total_high = 0u32;
    let mut all_high_pixels = Vec::new();

    for (y, (row_buf, count, pixels)) in rows.into_iter().enumerate() {
        let offset = y * w * 4;
        heatmap_buf[offset..offset + w * 4].copy_from_slice(&row_buf);
        total_high += count;
        all_high_pixels.extend(pixels);
    }

    (heatmap_buf, total_high, all_high_pixels)
}

// color-mono 用の前処理: 両画像をグレースケール化（RGBA 形式は維持、R=G=B=luma）し、
// モノクロ側の濃い部分だけを mask=1 とする。
// 戻り値: (rgba_a_gray, rgba_b_gray, mask, width, height)
fn heatmap_diff_probability(high_density_count: u32, width: u32, height: u32) -> f64 {
    if high_density_count == 0 {
        return 0.0;
    }

    let total_pixels = ((width as f64) * (height as f64)).max(1.0);
    let high_density_ratio = high_density_count as f64 / total_pixels;
    let score = (1.0 - (-high_density_ratio * 120.0).exp()) * 100.0;
    (score.clamp(0.1, 100.0) * 10.0).round() / 10.0
}

fn prepare_color_mono(
    img_a: &DynamicImage,
    img_b: &DynamicImage,
    dark_threshold: u8,
) -> (Vec<u8>, Vec<u8>, Vec<u8>, u32, u32) {
    let (wa, ha) = img_a.dimensions();
    let (wb, hb) = img_b.dimensions();
    let width = wa.max(wb);
    let height = ha.max(hb);

    // モノクロ側(B)の解像度に揃える方が安全だが、両者の最大に揃えて精度優先
    let img_a = if wa != width || ha != height {
        img_a.resize_exact(width, height, FilterType::CatmullRom)
    } else {
        img_a.clone()
    };
    let img_b = if wb != width || hb != height {
        img_b.resize_exact(width, height, FilterType::CatmullRom)
    } else {
        img_b.clone()
    };

    let mut rgba_a: Vec<u8> = img_a.to_rgba8().into_raw();
    let mut rgba_b: Vec<u8> = img_b.to_rgba8().into_raw();

    // ITU-R BT.601 luma 値で R=G=B 置換（A=RGB / B=Grayscale の色味差を吸収）
    rgba_a.par_chunks_mut(4).for_each(|p| {
        let y = ((p[0] as u32 * 299 + p[1] as u32 * 587 + p[2] as u32 * 114) / 1000) as u8;
        p[0] = y;
        p[1] = y;
        p[2] = y;
    });
    rgba_b.par_chunks_mut(4).for_each(|p| {
        let y = ((p[0] as u32 * 299 + p[1] as u32 * 587 + p[2] as u32 * 114) / 1000) as u8;
        p[0] = y;
        p[1] = y;
        p[2] = y;
    });

    // モノクロ側の濃い領域だけを mask=1 にする（dark_threshold 以下＝濃い）
    let mask: Vec<u8> = rgba_b
        .par_chunks(4)
        .map(|p| if p[0] <= dark_threshold { 1u8 } else { 0u8 })
        .collect();

    (rgba_a, rgba_b, mask, width, height)
}

// color-mono 用の差分計算（ヒートマップ + モノクロ濃部マスク）
#[tauri::command]
fn compute_diff_color_mono(
    path_a: String, // カラー (RGB 350dpi)
    path_b: String, // モノクロ (Grayscale 600dpi)
    threshold: u8,
    dark_threshold: Option<u8>, // この値以下を「濃い」として比較対象にする (default 200)
) -> Result<DiffHeatmapResult, String> {
    ensure_allowed_read(&path_a)?;
    ensure_allowed_read(&path_b)?;
    let (img_a, img_b) = rayon::join(|| decode_image_file(&path_a), || decode_image_file(&path_b));
    let img_a = img_a?;
    let img_b = img_b?;

    let dark = dark_threshold.unwrap_or(200);
    let (rgba_a, rgba_b, mask, width, height) = prepare_color_mono(&img_a, &img_b, dark);

    // ヒートマップ差分計算
    let (heatmap_buf, high_density_count, high_pixels) =
        diff_heatmap_core_masked(&rgba_a, &rgba_b, &mask, width, height, threshold);

    // マーカークラスタリング (psd-tiff と同じパラメータ)
    let markers = cluster_markers(&high_pixels, 250, 20, 80.0);

    // diffProbability
    let diff_probability = heatmap_diff_probability(high_density_count, width, height);

    // 表示用エンコード: オリジナルA(カラーのまま) / オリジナルB(モノクロのまま) / 差分ヒートマップ
    // ※ A表示・B表示はカラー/モノクロのオリジナルをそのまま見せる。グレースケール化は差分計算専用。
    let cache_a = format!("colmono_a_{}", versioned_path_key(&path_a));
    let cache_b = format!("colmono_b_{}", versioned_path_key(&path_b));
    let cache_d = format!(
        "colmono_d_{}_{}",
        versioned_path_key(&path_a),
        versioned_path_key(&path_b)
    );

    // rgba_a はグレースケール化済みバッファだが、もう不要（diff計算後）— 即解放
    drop(rgba_a);
    drop(rgba_b);
    drop(mask);

    let ((src_a_result, src_b_result), diff_result) = rayon::join(
        || {
            rayon::join(
                || encode_to_jpeg_temp(&img_a, &cache_a),
                || encode_to_jpeg_temp(&img_b, &cache_b),
            )
        },
        || encode_rgba_to_png_temp(&heatmap_buf, width, height, &cache_d),
    );

    let src_a = src_a_result?;
    Ok(DiffHeatmapResult {
        src_a: src_a.clone(),
        src_b: src_b_result?,
        // processed_a はフロント側でカラーのまま表示するため、src_a と同一値を返す
        processed_a: src_a,
        diff_src: diff_result?,
        has_diff: high_density_count > 0,
        diff_probability,
        high_density_count,
        markers,
        image_width: width,
        image_height: height,
    })
}

// color-mono 用の Phase1 軽量チェック（画像エンコードなし）
#[tauri::command]
fn check_diff_color_mono(
    path_a: String,
    path_b: String,
    threshold: u8,
    dark_threshold: Option<u8>,
) -> Result<DiffCheckHeatmapResult, String> {
    ensure_allowed_read(&path_a)?;
    ensure_allowed_read(&path_b)?;
    let (img_a, img_b) = rayon::join(|| decode_image_file(&path_a), || decode_image_file(&path_b));
    let img_a = img_a?;
    let img_b = img_b?;

    let dark = dark_threshold.unwrap_or(200);
    let (rgba_a, rgba_b, mask, width, height) = prepare_color_mono(&img_a, &img_b, dark);

    let (_heatmap_buf, high_density_count, high_pixels) =
        diff_heatmap_core_masked(&rgba_a, &rgba_b, &mask, width, height, threshold);

    let markers = cluster_markers(&high_pixels, 250, 20, 80.0);

    let diff_probability = heatmap_diff_probability(high_density_count, width, height);

    Ok(DiffCheckHeatmapResult {
        has_diff: high_density_count > 0,
        diff_probability,
        high_density_count,
        markers,
        image_width: width,
        image_height: height,
    })
}

// Union-Findクラスタリング → DiffMarkerリスト
fn cluster_markers(
    pixels: &[DiffPixel],
    grid_size: u32,
    min_cluster: u32,
    min_radius: f64,
) -> Vec<DiffMarker> {
    if pixels.is_empty() {
        return Vec::new();
    }

    // グリッドにピクセルを分配
    struct GridCell {
        gx: i32,
        gy: i32,
        count: u32,
        min_x: u32,
        max_x: u32,
        min_y: u32,
        max_y: u32,
    }

    let mut grid: HashMap<(i32, i32), GridCell> = HashMap::new();
    for p in pixels {
        let gx = (p.x / grid_size) as i32;
        let gy = (p.y / grid_size) as i32;
        let cell = grid.entry((gx, gy)).or_insert(GridCell {
            gx,
            gy,
            count: 0,
            min_x: p.x,
            max_x: p.x,
            min_y: p.y,
            max_y: p.y,
        });
        cell.count += 1;
        cell.min_x = cell.min_x.min(p.x);
        cell.max_x = cell.max_x.max(p.x);
        cell.min_y = cell.min_y.min(p.y);
        cell.max_y = cell.max_y.max(p.y);
    }

    let cells: Vec<GridCell> = grid.into_values().collect();
    if cells.is_empty() {
        return Vec::new();
    }

    // Union-Find
    let mut parent: Vec<usize> = (0..cells.len()).collect();
    let find = |parent: &mut Vec<usize>, mut i: usize| -> usize {
        while parent[i] != i {
            parent[i] = parent[parent[i]];
            i = parent[i];
        }
        i
    };

    for i in 0..cells.len() {
        for j in (i + 1)..cells.len() {
            let dx = (cells[i].gx - cells[j].gx).abs();
            let dy = (cells[i].gy - cells[j].gy).abs();
            if dx <= 1 && dy <= 1 {
                let pi = find(&mut parent, i);
                let pj = find(&mut parent, j);
                if pi != pj {
                    parent[pi] = pj;
                }
            }
        }
    }

    // グループ集約
    let mut groups: HashMap<usize, (u32, u32, u32, u32, u32)> = HashMap::new(); // minX, maxX, minY, maxY, count
    for (i, cell) in cells.iter().enumerate() {
        let root = find(&mut parent, i);
        let g = groups.entry(root).or_insert((u32::MAX, 0, u32::MAX, 0, 0));
        g.0 = g.0.min(cell.min_x);
        g.1 = g.1.max(cell.max_x);
        g.2 = g.2.min(cell.min_y);
        g.3 = g.3.max(cell.max_y);
        g.4 += cell.count;
    }

    let mut markers: Vec<DiffMarker> = groups
        .values()
        .filter(|g| g.4 >= min_cluster)
        .map(|g| {
            let cx = (g.0 as f64 + g.1 as f64) / 2.0;
            let cy = (g.2 as f64 + g.3 as f64) / 2.0;
            let radius_x =
                (g.1 as f64 - g.0 as f64) / 2.0 + if min_radius > 200.0 { 100.0 } else { 60.0 };
            let radius_y =
                (g.3 as f64 - g.2 as f64) / 2.0 + if min_radius > 200.0 { 100.0 } else { 60.0 };
            let marker_radius = min_radius.max(radius_x.max(radius_y));
            DiffMarker {
                x: cx,
                y: cy,
                radius: marker_radius,
                count: g.4,
            }
        })
        .collect();

    markers.sort_by(|a, b| b.count.cmp(&a.count));
    markers
}

// tiff-tiff / psd-psd 用の差分計算
#[tauri::command]
fn compute_diff_simple(
    path_a: String,
    path_b: String,
    threshold: u8,
) -> Result<DiffSimpleResult, String> {
    ensure_allowed_read(&path_a)?;
    ensure_allowed_read(&path_b)?;
    // 2ファイル並列デコード
    let (img_a, img_b) = rayon::join(|| decode_image_file(&path_a), || decode_image_file(&path_b));
    let img_a = img_a?;
    let img_b = img_b?;

    let (wa, ha) = img_a.dimensions();
    let (wb, hb) = img_b.dimensions();
    let width = wa.max(wb);
    let height = ha.max(hb);

    // 必要ならリサイズ
    let img_a = if wa != width || ha != height {
        img_a.resize_exact(width, height, FilterType::Triangle)
    } else {
        img_a
    };
    let img_b = if wb != width || hb != height {
        img_b.resize_exact(width, height, FilterType::Triangle)
    } else {
        img_b
    };

    let rgba_a = img_a.to_rgba8();
    let rgba_b = img_b.to_rgba8();

    // 差分計算
    let (diff_buf, diff_count, diff_pixels) =
        diff_simple_core(rgba_a.as_raw(), rgba_b.as_raw(), width, height, threshold);

    // マーカークラスタリング
    let markers = cluster_markers(&diff_pixels, 200, 1, 300.0);

    // 3画像を並列エンコード → JPEG tempファイル（A/B）+ PNG tempファイル（diff）
    let cache_a = format!("simple_a_{}", versioned_path_key(&path_a));
    let cache_b = format!("simple_b_{}", versioned_path_key(&path_b));
    let cache_d = format!(
        "simple_d_{}_{}",
        versioned_path_key(&path_a),
        versioned_path_key(&path_b)
    );
    let (src_a_result, (src_b_result, diff_result)) = rayon::join(
        || encode_to_jpeg_temp(&img_a, &cache_a),
        || {
            rayon::join(
                || encode_to_jpeg_temp(&img_b, &cache_b),
                || encode_rgba_to_png_temp(&diff_buf, width, height, &cache_d),
            )
        },
    );

    Ok(DiffSimpleResult {
        src_a: src_a_result?,
        src_b: src_b_result?,
        diff_src: diff_result?,
        has_diff: diff_count > 0,
        diff_count,
        markers,
        image_width: width,
        image_height: height,
    })
}

// psd-tiff 用のヒートマップ差分計算
#[tauri::command]
fn compute_diff_heatmap(
    psd_path: String,
    tiff_path: String,
    crop_bounds: CropBounds,
    threshold: u8,
) -> Result<DiffHeatmapResult, String> {
    ensure_allowed_read(&psd_path)?;
    ensure_allowed_read(&tiff_path)?;
    // 並列デコード
    let (psd_result, tiff_result) = rayon::join(
        || decode_psd_to_image(&psd_path),
        || image::open(&tiff_path).map_err(|e| format!("Failed to open TIFF: {}", e)),
    );
    let psd_img = psd_result?;
    let tiff_img = tiff_result?;

    let (tiff_w, tiff_h) = tiff_img.dimensions();

    // PSDをクロップ
    let crop_w = crop_bounds.right - crop_bounds.left;
    let crop_h = crop_bounds.bottom - crop_bounds.top;
    let cropped = psd_img.crop_imm(crop_bounds.left, crop_bounds.top, crop_w, crop_h);

    // TIFFサイズにリサイズ（CatmullRom = Photoshop ResampleMethod.AUTOMATIC 相当）
    let processed_psd = cropped.resize_exact(tiff_w, tiff_h, FilterType::CatmullRom);

    let rgba_a = processed_psd.to_rgba8();
    let rgba_b = tiff_img.to_rgba8();

    // ヒートマップ差分計算
    let (heatmap_buf, high_density_count, high_pixels) =
        diff_heatmap_core(rgba_a.as_raw(), rgba_b.as_raw(), tiff_w, tiff_h, threshold);

    // マーカークラスタリング (gridSize=250, minCluster=20, minRadius=80)
    let markers = cluster_markers(&high_pixels, 250, 20, 80.0);

    // diffProbability計算
    let diff_probability = heatmap_diff_probability(high_density_count, tiff_w, tiff_h);

    // 4画像を並列エンコード → JPEG tempファイル（A/B/processedA）+ PNG tempファイル（diff）
    let cache_a = format!("heatmap_a_{}", versioned_path_key(&psd_path));
    let cache_b = format!("heatmap_b_{}", versioned_path_key(&tiff_path));
    let cache_pa = format!(
        "heatmap_pa_{}_{}",
        versioned_path_key(&psd_path),
        versioned_path_key(&tiff_path)
    );
    let cache_d = format!(
        "heatmap_d_{}_{}",
        versioned_path_key(&psd_path),
        versioned_path_key(&tiff_path)
    );
    let ((src_a_result, src_b_result), (processed_a_result, diff_result)) = rayon::join(
        || {
            rayon::join(
                || encode_to_jpeg_temp(&psd_img, &cache_a),
                || encode_to_jpeg_temp(&tiff_img, &cache_b),
            )
        },
        || {
            rayon::join(
                || encode_to_jpeg_temp(&processed_psd, &cache_pa),
                || encode_rgba_to_png_temp(&heatmap_buf, tiff_w, tiff_h, &cache_d),
            )
        },
    );

    Ok(DiffHeatmapResult {
        src_a: src_a_result?,
        src_b: src_b_result?,
        processed_a: processed_a_result?,
        diff_src: diff_result?,
        has_diff: high_density_count > 0,
        diff_probability,
        high_density_count,
        markers,
        image_width: tiff_w,
        image_height: tiff_h,
    })
}

// Phase1用: 軽量差分チェック（画像エンコードなし）
#[tauri::command]
fn check_diff_simple(
    path_a: String,
    path_b: String,
    threshold: u8,
) -> Result<DiffCheckSimpleResult, String> {
    ensure_allowed_read(&path_a)?;
    ensure_allowed_read(&path_b)?;
    // 2ファイル並列デコード
    let (img_a, img_b) = rayon::join(|| decode_image_file(&path_a), || decode_image_file(&path_b));
    let img_a = img_a?;
    let img_b = img_b?;

    let (wa, ha) = img_a.dimensions();
    let (wb, hb) = img_b.dimensions();
    let width = wa.max(wb);
    let height = ha.max(hb);

    // 必要ならリサイズ
    let img_a = if wa != width || ha != height {
        img_a.resize_exact(width, height, FilterType::Triangle)
    } else {
        img_a
    };
    let img_b = if wb != width || hb != height {
        img_b.resize_exact(width, height, FilterType::Triangle)
    } else {
        img_b
    };

    let rgba_a = img_a.to_rgba8();
    let rgba_b = img_b.to_rgba8();

    // 差分計算
    let (_diff_buf, diff_count, diff_pixels) =
        diff_simple_core(rgba_a.as_raw(), rgba_b.as_raw(), width, height, threshold);

    // マーカークラスタリング
    let markers = cluster_markers(&diff_pixels, 200, 1, 300.0);

    // 画像エンコードをスキップ！
    Ok(DiffCheckSimpleResult {
        has_diff: diff_count > 0,
        diff_count,
        markers,
        image_width: width,
        image_height: height,
    })
}

// Phase1用: 軽量ヒートマップ差分チェック（画像エンコードなし）
#[tauri::command]
fn check_diff_heatmap(
    psd_path: String,
    tiff_path: String,
    crop_bounds: CropBounds,
    threshold: u8,
) -> Result<DiffCheckHeatmapResult, String> {
    ensure_allowed_read(&psd_path)?;
    ensure_allowed_read(&tiff_path)?;
    // 並列デコード
    let (psd_result, tiff_result) = rayon::join(
        || decode_psd_to_image(&psd_path),
        || image::open(&tiff_path).map_err(|e| format!("Failed to open TIFF: {}", e)),
    );
    let psd_img = psd_result?;
    let tiff_img = tiff_result?;

    let (tiff_w, tiff_h) = tiff_img.dimensions();

    // PSDをクロップ
    let crop_w = crop_bounds.right - crop_bounds.left;
    let crop_h = crop_bounds.bottom - crop_bounds.top;
    let cropped = psd_img.crop_imm(crop_bounds.left, crop_bounds.top, crop_w, crop_h);

    // TIFFサイズにリサイズ（CatmullRom = Photoshop ResampleMethod.AUTOMATIC 相当）
    let processed_psd = cropped.resize_exact(tiff_w, tiff_h, FilterType::CatmullRom);

    let rgba_a = processed_psd.to_rgba8();
    let rgba_b = tiff_img.to_rgba8();

    // ヒートマップ差分計算
    let (_heatmap_buf, high_density_count, high_pixels) =
        diff_heatmap_core(rgba_a.as_raw(), rgba_b.as_raw(), tiff_w, tiff_h, threshold);

    // マーカークラスタリング
    let markers = cluster_markers(&high_pixels, 250, 20, 80.0);

    // diffProbability計算
    let diff_probability = heatmap_diff_probability(high_density_count, tiff_w, tiff_h);

    // 画像エンコードをスキップ！
    Ok(DiffCheckHeatmapResult {
        has_diff: high_density_count > 0,
        diff_probability,
        high_density_count,
        markers,
        image_width: tiff_w,
        image_height: tiff_h,
    })
}

// ============== PDF差分計算 (PDFium) ==============

use pdfium_render::prelude::*;

/// PDFiumライブラリのバインディングを取得
fn get_pdfium() -> Result<Pdfium, String> {
    // 実行ファイルと同じディレクトリからpdfium.dllを探す
    let exe_dir = std::env::current_exe()
        .map_err(|e| format!("Failed to get exe path: {}", e))?
        .parent()
        .ok_or_else(|| "Failed to get exe directory".to_string())?
        .to_path_buf();

    let bindings = Pdfium::bind_to_library(Pdfium::pdfium_platform_library_name_at_path(&exe_dir))
        .or_else(|_| Pdfium::bind_to_system_library())
        .map_err(|e| {
            format!(
                "Failed to load PDFium library: {}. Place pdfium.dll next to the executable.",
                e
            )
        })?;

    Ok(Pdfium::new(bindings))
}

/// PDFiumで指定ページをRGBA画像にレンダリング
/// high_quality=true は差分計算用 (print quality 有効)。並列ビュー表示用は false。
fn render_pdf_page_pdfium(
    pdfium: &Pdfium,
    path: &str,
    page: u32,
    dpi: f32,
    high_quality: bool,
) -> Result<(Vec<u8>, u32, u32), String> {
    let doc = pdfium
        .load_pdf_from_file(path, None)
        .map_err(|e| format!("Failed to open PDF '{}': {}", path, e))?;

    let page_count = doc.pages().len() as u32;
    if page >= page_count {
        return Err(format!(
            "Page {} out of range (total: {})",
            page, page_count
        ));
    }

    let pg = doc
        .pages()
        .get(page as u16)
        .map_err(|e| format!("Failed to load page {}: {}", page, e))?;

    let scale = dpi / 72.0;
    let config = PdfRenderConfig::new()
        .scale_page_by_factor(scale)
        .use_print_quality(high_quality);

    let bitmap = pg
        .render_with_config(&config)
        .map_err(|e| format!("Failed to render page {}: {}", page, e))?;

    let width = bitmap.width() as u32;
    let height = bitmap.height() as u32;
    let rgba = bitmap.as_rgba_bytes();

    Ok((rgba, width, height))
}

// PDF-PDF差分計算（PDFiumレンダリング + rayon並列差分）
#[tauri::command]
fn compute_pdf_diff(
    path_a: String,
    path_b: String,
    page: u32,
    dpi: f32,
    threshold: u8,
) -> Result<DiffSimpleResult, String> {
    ensure_allowed_read(&path_a)?;
    ensure_allowed_read(&path_b)?;
    let pdfium = get_pdfium()?;

    let (samples_a, wa, ha) = render_pdf_page_pdfium(&pdfium, &path_a, page, dpi, true)?;
    let (samples_b, wb, hb) = render_pdf_page_pdfium(&pdfium, &path_b, page, dpi, true)?;

    let width = wa.max(wb);
    let height = ha.max(hb);

    // サイズが異なる場合はDynamicImageでリサイズ
    let rgba_a = if wa != width || ha != height {
        let img: ImageBuffer<Rgba<u8>, Vec<u8>> = ImageBuffer::from_raw(wa, ha, samples_a)
            .ok_or_else(|| "Failed to create image buffer A".to_string())?;
        let dyn_img = DynamicImage::ImageRgba8(img);
        dyn_img
            .resize_exact(width, height, FilterType::Triangle)
            .to_rgba8()
    } else {
        ImageBuffer::from_raw(wa, ha, samples_a)
            .ok_or_else(|| "Failed to create image buffer A".to_string())?
    };

    let rgba_b = if wb != width || hb != height {
        let img: ImageBuffer<Rgba<u8>, Vec<u8>> = ImageBuffer::from_raw(wb, hb, samples_b)
            .ok_or_else(|| "Failed to create image buffer B".to_string())?;
        let dyn_img = DynamicImage::ImageRgba8(img);
        dyn_img
            .resize_exact(width, height, FilterType::Triangle)
            .to_rgba8()
    } else {
        ImageBuffer::from_raw(wb, hb, samples_b)
            .ok_or_else(|| "Failed to create image buffer B".to_string())?
    };

    // rayon並列差分計算
    let (diff_buf, diff_count, diff_pixels) =
        diff_simple_core(rgba_a.as_raw(), rgba_b.as_raw(), width, height, threshold);

    // マーカークラスタリング
    let markers = cluster_markers(&diff_pixels, 200, 1, 300.0);

    // 3画像を並列エンコード → JPEG tempファイル（A/B）+ PNG tempファイル（diff）
    let img_a = DynamicImage::ImageRgba8(rgba_a);
    let img_b = DynamicImage::ImageRgba8(rgba_b);
    let cache_a = format!("pdf_a_{}_p{}", versioned_path_key(&path_a), page);
    let cache_b = format!("pdf_b_{}_p{}", versioned_path_key(&path_b), page);
    let cache_d = format!(
        "pdf_d_{}_{}_p{}",
        versioned_path_key(&path_a),
        versioned_path_key(&path_b),
        page
    );
    let (src_a_result, (src_b_result, diff_result)) = rayon::join(
        || encode_to_jpeg_temp(&img_a, &cache_a),
        || {
            rayon::join(
                || encode_to_jpeg_temp(&img_b, &cache_b),
                || encode_rgba_to_png_temp(&diff_buf, width, height, &cache_d),
            )
        },
    );

    Ok(DiffSimpleResult {
        src_a: src_a_result?,
        src_b: src_b_result?,
        diff_src: diff_result?,
        has_diff: diff_count > 0,
        diff_count,
        markers,
        image_width: width,
        image_height: height,
    })
}

// ============== psd-pdf（PSD vs PDF/画像）差分計算 ==============

/// 参照ファイル（PDF または画像）をデコード → 縮尺を PSD に合わせるための寸法情報を返す
/// PDF の場合は指定された `page`（0-indexed）をレンダリングする。画像は page>0 でエラー。
fn decode_reference_for_psd_compare(
    ref_path: &str,
    psd_w: u32,
    psd_h: u32,
    page: u32,
) -> Result<DynamicImage, String> {
    let lower = ref_path.to_lowercase();
    if lower.ends_with(".pdf") {
        let pdfium = get_pdfium()?;

        // 指定ページの素の viewport サイズ（pt）を取得 → PSD寸法に合わせたDPIを算出
        let (pt_w, pt_h) = {
            let doc = pdfium
                .load_pdf_from_file(ref_path, None)
                .map_err(|e| format!("Failed to open PDF '{}': {}", ref_path, e))?;
            let page_count = doc.pages().len() as u32;
            if page_count == 0 {
                return Err("PDFにページがありません".to_string());
            }
            if page >= page_count {
                return Err(format!(
                    "PDF ページ {} は範囲外です (総ページ数: {})",
                    page + 1,
                    page_count
                ));
            }
            let pg = doc
                .pages()
                .get(page as u16)
                .map_err(|e| format!("Failed to load PDF page {}: {}", page + 1, e))?;
            (pg.width().value as f32, pg.height().value as f32)
        };

        let scale_by_w = if pt_w > 0.0 {
            psd_w as f32 / pt_w
        } else {
            300.0 / 72.0
        };
        let scale_by_h = if pt_h > 0.0 {
            psd_h as f32 / pt_h
        } else {
            scale_by_w
        };
        let scale = scale_by_w
            .min(scale_by_h)
            .max(150.0 / 72.0)
            .min(600.0 / 72.0);
        let dpi = scale * 72.0;

        let (samples, w, h) = render_pdf_page_pdfium(&pdfium, ref_path, page, dpi, true)?;
        let buf: ImageBuffer<Rgba<u8>, Vec<u8>> = ImageBuffer::from_raw(w, h, samples)
            .ok_or_else(|| "Failed to create PDF buffer".to_string())?;
        Ok(DynamicImage::ImageRgba8(buf))
    } else {
        if page > 0 {
            return Err(format!(
                "画像ファイルにはページ {} はありません",
                page + 1
            ));
        }
        image::open(ref_path).map_err(|e| format!("Failed to open reference '{}': {}", ref_path, e))
    }
}

/// 「動かす側 (mover)」をアスペクト比保持で「キャンバス側 (canvas_w×canvas_h)」にフィットさせ、
/// ユーザー指定の描画位置オフセット（X/Y、ピクセル単位）で平行移動する。
/// `scale_user`=1.0 は自動フィット、それ以外は微調整倍率。
/// この関数は PSD↔PDF どちらをアンカーにしても同じロジックで使える（mover の中身が違うだけ）。
fn render_aligned_to_canvas(
    mover_img: &DynamicImage,
    canvas_w: u32,
    canvas_h: u32,
    scale_user: f32,
    offset_x: i32,
    offset_y: i32,
) -> DynamicImage {
    let (mw, mh) = mover_img.dimensions();
    let sx = canvas_w as f32 / (mw.max(1) as f32);
    let sy = canvas_h as f32 / (mh.max(1) as f32);
    let scale = sx.min(sy) * scale_user;

    let drawn_w = ((mw as f32) * scale).round().max(1.0) as u32;
    let drawn_h = ((mh as f32) * scale).round().max(1.0) as u32;

    let scaled = mover_img.resize_exact(drawn_w, drawn_h, FilterType::CatmullRom);
    let scaled_rgba = scaled.to_rgba8();

    let mut canvas: ImageBuffer<Rgba<u8>, Vec<u8>> =
        ImageBuffer::from_pixel(canvas_w, canvas_h, Rgba([255, 255, 255, 255]));
    let origin_x = (canvas_w as i64 - drawn_w as i64) / 2 + offset_x as i64;
    let origin_y = (canvas_h as i64 - drawn_h as i64) / 2 + offset_y as i64;
    for y in 0..drawn_h as i64 {
        let cy = origin_y + y;
        if cy < 0 || cy >= canvas_h as i64 {
            continue;
        }
        for x in 0..drawn_w as i64 {
            let cx = origin_x + x;
            if cx < 0 || cx >= canvas_w as i64 {
                continue;
            }
            let p = scaled_rgba.get_pixel(x as u32, y as u32);
            canvas.put_pixel(cx as u32, cy as u32, *p);
        }
    }
    DynamicImage::ImageRgba8(canvas)
}


#[tauri::command]
fn compute_diff_psd_pdf(
    psd_path: String,
    ref_path: String,
    threshold: u8,
    scale: Option<f32>,
    offset_x: Option<i32>,
    offset_y: Option<i32>,
    anchor: Option<String>,
    page: Option<u32>,
    diff_style: Option<String>,
) -> Result<DiffHeatmapResult, String> {
    ensure_allowed_read(&psd_path)?;
    ensure_allowed_read(&ref_path)?;
    let scale = scale.unwrap_or(1.0).clamp(0.5, 2.0);
    let offset_x = offset_x.unwrap_or(0);
    let offset_y = offset_y.unwrap_or(0);
    let anchor_is_psd = anchor.as_deref() == Some("psd");
    let page = page.unwrap_or(0);

    // PSDはプロセス内キャッシュを使う（多ページPDFの場合、毎回のデコードを回避）
    let psd_arc = decode_psd_cached(&psd_path)?;
    let psd_img: &DynamicImage = &psd_arc;
    let (psd_w, psd_h) = psd_img.dimensions();
    let ref_img = decode_reference_for_psd_compare(&ref_path, psd_w, psd_h, page)?;
    let (rw, rh) = ref_img.dimensions();

    let (canvas_w, canvas_h, canvas_img, mover_img) = if anchor_is_psd {
        (psd_w, psd_h, psd_img, &ref_img)
    } else {
        (rw, rh, &ref_img, psd_img)
    };

    let processed_mover =
        render_aligned_to_canvas(mover_img, canvas_w, canvas_h, scale, offset_x, offset_y);

    let (rgba_a, rgba_b) = if anchor_is_psd {
        (canvas_img.to_rgba8(), processed_mover.to_rgba8())
    } else {
        (processed_mover.to_rgba8(), canvas_img.to_rgba8())
    };

    let use_simple_diff = diff_style.as_deref() == Some("simple");
    let (diff_buf, diff_count, markers, diff_probability) = if use_simple_diff {
        let (diff_buf, diff_count, diff_pixels) =
            diff_simple_core(rgba_a.as_raw(), rgba_b.as_raw(), canvas_w, canvas_h, threshold);
        let markers = cluster_markers(&diff_pixels, 200, 1, 300.0);
        (diff_buf, diff_count, markers, 0.0)
    } else {
        let (heatmap_buf, high_density_count, high_pixels) =
            diff_heatmap_core(rgba_a.as_raw(), rgba_b.as_raw(), canvas_w, canvas_h, threshold);
        let markers = cluster_markers(&high_pixels, 250, 20, 80.0);
        let diff_probability = heatmap_diff_probability(high_density_count, canvas_w, canvas_h);
        (heatmap_buf, high_density_count, markers, diff_probability)
    };

    // anchor=psd のときは A 側に出すのは PSD オリジナル、anchor=ref のときは PSD を ref に揃えた絵
    let processed_a_to_encode: DynamicImage = if anchor_is_psd {
        psd_img.clone()
    } else {
        processed_mover.clone()
    };

    let cache_a = format!("psdpdf_a_{}", versioned_path_key(&psd_path));
    let cache_b = format!("psdpdf_b_{}_p{}", versioned_path_key(&ref_path), page);
    let cache_pa = format!(
        "psdpdf_pa_{}_{}_{}_p{}_{}_{}_{}",
        versioned_path_key(&psd_path),
        versioned_path_key(&ref_path),
        if anchor_is_psd { "psd" } else { "ref" },
        page,
        (scale * 10000.0) as i32,
        offset_x,
        offset_y
    );
    let cache_d = format!(
        "psdpdf_{}_d_{}_{}_{}_p{}_{}_{}_{}",
        if use_simple_diff { "simple" } else { "heatmap" },
        versioned_path_key(&psd_path),
        versioned_path_key(&ref_path),
        if anchor_is_psd { "psd" } else { "ref" },
        page,
        (scale * 10000.0) as i32,
        offset_x,
        offset_y
    );
    let ((src_a_result, src_b_result), (processed_a_result, diff_result)) = rayon::join(
        || {
            rayon::join(
                || encode_to_jpeg_temp(&psd_img, &cache_a),
                || encode_to_jpeg_temp(&ref_img, &cache_b),
            )
        },
        || {
            rayon::join(
                || encode_to_jpeg_temp(&processed_a_to_encode, &cache_pa),
                || encode_rgba_to_png_temp(&diff_buf, canvas_w, canvas_h, &cache_d),
            )
        },
    );

    Ok(DiffHeatmapResult {
        src_a: src_a_result?,
        src_b: src_b_result?,
        processed_a: processed_a_result?,
        diff_src: diff_result?,
        has_diff: diff_count > 0,
        diff_probability,
        high_density_count: diff_count,
        markers,
        image_width: canvas_w,
        image_height: canvas_h,
    })
}

// Phase1用: psd-pdf 軽量チェック（画像エンコードなし）
#[tauri::command]
fn check_diff_psd_pdf(
    psd_path: String,
    ref_path: String,
    threshold: u8,
    scale: Option<f32>,
    offset_x: Option<i32>,
    offset_y: Option<i32>,
    anchor: Option<String>,
    page: Option<u32>,
    diff_style: Option<String>,
) -> Result<DiffCheckHeatmapResult, String> {
    ensure_allowed_read(&psd_path)?;
    ensure_allowed_read(&ref_path)?;
    let scale = scale.unwrap_or(1.0).clamp(0.5, 2.0);
    let offset_x = offset_x.unwrap_or(0);
    let offset_y = offset_y.unwrap_or(0);
    let anchor_is_psd = anchor.as_deref() == Some("psd");
    let page = page.unwrap_or(0);

    let psd_arc = decode_psd_cached(&psd_path)?;
    let psd_img: &DynamicImage = &psd_arc;
    let (psd_w, psd_h) = psd_img.dimensions();
    let ref_img = decode_reference_for_psd_compare(&ref_path, psd_w, psd_h, page)?;
    let (rw, rh) = ref_img.dimensions();

    let (canvas_w, canvas_h, canvas_img, mover_img) = if anchor_is_psd {
        (psd_w, psd_h, psd_img, &ref_img)
    } else {
        (rw, rh, &ref_img, psd_img)
    };
    let processed_mover =
        render_aligned_to_canvas(mover_img, canvas_w, canvas_h, scale, offset_x, offset_y);

    let (rgba_a, rgba_b) = if anchor_is_psd {
        (canvas_img.to_rgba8(), processed_mover.to_rgba8())
    } else {
        (processed_mover.to_rgba8(), canvas_img.to_rgba8())
    };

    let use_simple_diff = diff_style.as_deref() == Some("simple");
    let (diff_count, markers, diff_probability) = if use_simple_diff {
        let (_diff_buf, diff_count, diff_pixels) =
            diff_simple_core(rgba_a.as_raw(), rgba_b.as_raw(), canvas_w, canvas_h, threshold);
        let markers = cluster_markers(&diff_pixels, 200, 1, 300.0);
        (diff_count, markers, 0.0)
    } else {
        let (_heatmap_buf, high_density_count, high_pixels) =
            diff_heatmap_core(rgba_a.as_raw(), rgba_b.as_raw(), canvas_w, canvas_h, threshold);
        let markers = cluster_markers(&high_pixels, 250, 20, 80.0);
        let diff_probability = heatmap_diff_probability(high_density_count, canvas_w, canvas_h);
        (high_density_count, markers, diff_probability)
    };

    Ok(DiffCheckHeatmapResult {
        has_diff: diff_count > 0,
        diff_probability,
        high_density_count: diff_count,
        markers,
        image_width: canvas_w,
        image_height: canvas_h,
    })
}

// ============== psd-pdf 自動位置合わせ ==============

#[derive(Serialize)]
struct AutoAlignResult {
    best_scale: f32,
    best_offset_x: i32,
    best_offset_y: i32,
    src_a: String,
    src_b: String,
    processed_a: String,
    diff_src: String,
    has_diff: bool,
    diff_probability: f64,
    high_density_count: u32,
    markers: Vec<DiffMarker>,
    image_width: u32,
    image_height: u32,
}

/// 事前にリサイズ済みの「動かす側」を、与えられたオフセットでキャンバスに重ねたときの
/// "重なり領域のみ" の平均ピクセル差分を返す（×1000 で整数精度キープ、小さいほど一致）。
/// PSDがカバーしていない領域（サイズ・オフセットでキャンバスからはみ出る/足りない部分）は
/// 合計にも分母にも含めない＝差分ゼロ扱い。
/// 重なりが5%未満の候補は u64::MAX を返して棄却する。
fn score_overlap_only(
    scaled_mover_rgba: &RgbaImage,
    canvas_rgba: &RgbaImage,
    canvas_w: u32,
    canvas_h: u32,
    offset_x: i32,
    offset_y: i32,
) -> u64 {
    let (sw, sh) = scaled_mover_rgba.dimensions();
    let origin_x = (canvas_w as i64 - sw as i64) / 2 + offset_x as i64;
    let origin_y = (canvas_h as i64 - sh as i64) / 2 + offset_y as i64;

    let x0 = (-origin_x).max(0).min(sw as i64) as u32;
    let y0 = (-origin_y).max(0).min(sh as i64) as u32;
    let x1 = (canvas_w as i64 - origin_x).max(0).min(sw as i64) as u32;
    let y1 = (canvas_h as i64 - origin_y).max(0).min(sh as i64) as u32;

    if x1 <= x0 || y1 <= y0 {
        return u64::MAX;
    }
    let overlap_pixels = ((x1 - x0) as u64) * ((y1 - y0) as u64);
    let min_overlap = ((canvas_w as u64) * (canvas_h as u64)) / 20;
    if overlap_pixels < min_overlap {
        return u64::MAX;
    }

    let mover_data = scaled_mover_rgba.as_raw();
    let canvas_data = canvas_rgba.as_raw();
    let mut sum: u64 = 0;
    for py in y0..y1 {
        let cy = (origin_y + py as i64) as u32;
        let mover_row = (py as usize) * (sw as usize) * 4;
        let canvas_row = (cy as usize) * (canvas_w as usize) * 4;
        for px in x0..x1 {
            let cx = (origin_x + px as i64) as u32;
            let mi = mover_row + (px as usize) * 4;
            let ci = canvas_row + (cx as usize) * 4;
            let dr = (canvas_data[ci] as i32 - mover_data[mi] as i32).unsigned_abs() as u64;
            let dg = (canvas_data[ci + 1] as i32 - mover_data[mi + 1] as i32).unsigned_abs() as u64;
            let db = (canvas_data[ci + 2] as i32 - mover_data[mi + 2] as i32).unsigned_abs() as u64;
            sum += dr + dg + db;
        }
    }

    sum.saturating_mul(1000) / overlap_pixels.max(1)
}

/// アスペクト比保持で `mover` を canvas_w×canvas_h に向けてフィットスケールし、
/// さらに `scale_user` を掛けた寸法でリサイズ → RgbaImage を返す。
fn make_scaled_mover_rgba(
    mover_thumb: &DynamicImage,
    canvas_w: u32,
    canvas_h: u32,
    scale_user: f32,
) -> RgbaImage {
    let (mw, mh) = mover_thumb.dimensions();
    let sx = canvas_w as f32 / (mw.max(1) as f32);
    let sy = canvas_h as f32 / (mh.max(1) as f32);
    let final_s = sx.min(sy) * scale_user;
    let dw = ((mw as f32) * final_s).round().max(1.0) as u32;
    let dh = ((mh as f32) * final_s).round().max(1.0) as u32;
    mover_thumb
        .resize_exact(dw, dh, FilterType::Triangle)
        .to_rgba8()
}

/// 中心を固定したまま、最良スケールだけを 5 段階で探索する。
/// offset は常に (0, 0) を返す（描画中心 = キャンバス中央 を保持）。
/// 中心固定なら scale 1次元探索なので、その分のリソースを精度向上に振り分ける。
fn search_best_scale_centered(
    mover_thumb: &DynamicImage,
    canvas_thumb_rgba: &RgbaImage,
    tw: u32,
    th: u32,
) -> (f32, i32, i32) {
    // 与えられたスケール集合のうち最良 (最小スコア) のものを返す
    let score_at_scale = |s: f32| -> u64 {
        let scaled = make_scaled_mover_rgba(mover_thumb, tw, th, s);
        score_overlap_only(&scaled, canvas_thumb_rgba, tw, th, 0, 0)
    };

    let best_in = |scales: Vec<f32>| -> (u64, f32) {
        scales
            .into_par_iter()
            .map(|s| (score_at_scale(s), s))
            .min_by_key(|x| x.0)
            .unwrap_or((u64::MAX, 1.0))
    };

    // ============ Pass 1: 粗探索 0.80〜1.20 step 2% (21点) ============
    let scales_coarse: Vec<f32> = (-10..=10).map(|i| 1.0 + (i as f32) * 0.02).collect();
    let (_, s1) = best_in(scales_coarse);

    // ============ Pass 2: 中探索 ±2% step 0.5% (9点) ============
    let scales_mid: Vec<f32> = (-4..=4)
        .map(|i| s1 + (i as f32) * 0.005)
        .filter(|s| *s > 0.5 && *s < 2.0)
        .collect();
    let (_, s2) = best_in(scales_mid);

    // ============ Pass 3: 精探索 ±0.5% step 0.05% (21点) ============
    let scales_fine: Vec<f32> = (-10..=10)
        .map(|i| s2 + (i as f32) * 0.0005)
        .filter(|s| *s > 0.5 && *s < 2.0)
        .collect();
    let (_, s3) = best_in(scales_fine);

    // ============ Pass 4: 超精探索 ±0.02% step 0.002% (21点) ============
    let scales_ultra: Vec<f32> = (-10..=10)
        .map(|i| s3 + (i as f32) * 0.00002)
        .filter(|s| *s > 0.5 && *s < 2.0)
        .collect();
    let (_, s4) = best_in(scales_ultra);

    // ============ Pass 5: 究極精探索 ±0.005% step 0.0005% (21点 / 5 ppm刻み) ============
    let scales_micro: Vec<f32> = (-10..=10)
        .map(|i| s4 + (i as f32) * 0.000005)
        .filter(|s| *s > 0.5 && *s < 2.0)
        .collect();
    let (_, s_final) = best_in(scales_micro);

    (s_final, 0, 0)
}

/// 自動位置合わせ。
/// `anchor`: "ref" (デフォルト) なら PDF/画像が基準で PSD を動かす。
///           "psd"             なら PSD が基準で PDF/画像を動かす。
#[tauri::command]
fn auto_align_psd_pdf(
    psd_path: String,
    ref_path: String,
    threshold: u8,
    anchor: Option<String>,
    page: Option<u32>,
    diff_style: Option<String>,
) -> Result<AutoAlignResult, String> {
    ensure_allowed_read(&psd_path)?;
    ensure_allowed_read(&ref_path)?;
    let anchor = anchor.as_deref().unwrap_or("ref");
    let anchor_is_psd = anchor == "psd";
    let page = page.unwrap_or(0);

    // フル解像度でデコード（PSDはキャッシュ経由）
    let psd_arc = decode_psd_cached(&psd_path)?;
    let psd_img: &DynamicImage = &psd_arc;
    let (psd_w, psd_h) = psd_img.dimensions();
    let ref_img = decode_reference_for_psd_compare(&ref_path, psd_w, psd_h, page)?;
    let (rw, rh) = ref_img.dimensions();

    // アンカー / ムーバーを選ぶ
    let (canvas_w, canvas_h, canvas_img, mover_img) = if anchor_is_psd {
        (psd_w, psd_h, psd_img, &ref_img)
    } else {
        (rw, rh, &ref_img, psd_img)
    };

    // 探索用サムネ（最大1000px）— 大きい方が scale 識別解像度が上がる
    let max_thumb_dim: u32 = 1000;
    let thumb_ratio = (max_thumb_dim as f32 / canvas_w.max(canvas_h) as f32).min(1.0);
    let tw = ((canvas_w as f32) * thumb_ratio).round().max(1.0) as u32;
    let th = ((canvas_h as f32) * thumb_ratio).round().max(1.0) as u32;
    let mover_thumb = mover_img.resize_exact(
        ((mover_img.width() as f32) * thumb_ratio).round().max(1.0) as u32,
        ((mover_img.height() as f32) * thumb_ratio).round().max(1.0) as u32,
        FilterType::Triangle,
    );
    let canvas_thumb = canvas_img.resize_exact(tw, th, FilterType::Triangle);
    let canvas_thumb_rgba = canvas_thumb.to_rgba8();

    // 中心固定で 5 段階スケール探索（精度: ±0.005% / 中心は (0,0) 固定）
    let (best_scale, _, _) =
        search_best_scale_centered(&mover_thumb, &canvas_thumb_rgba, tw, th);
    let final_offset_x: i32 = 0;
    let final_offset_y: i32 = 0;

    // === ベストパラメータでフル解像度の差分を計算 ===
    let processed_mover = render_aligned_to_canvas(
        mover_img,
        canvas_w,
        canvas_h,
        best_scale,
        final_offset_x,
        final_offset_y,
    );

    let (rgba_a, rgba_b, diff_w, diff_h) = if anchor_is_psd {
        (
            canvas_img.to_rgba8(),
            processed_mover.to_rgba8(),
            canvas_w,
            canvas_h,
        )
    } else {
        (
            processed_mover.to_rgba8(),
            canvas_img.to_rgba8(),
            canvas_w,
            canvas_h,
        )
    };
    let use_simple_diff = diff_style.as_deref() == Some("simple");
    let (diff_buf, diff_count, markers, diff_probability) = if use_simple_diff {
        let (diff_buf, diff_count, diff_pixels) =
            diff_simple_core(rgba_a.as_raw(), rgba_b.as_raw(), diff_w, diff_h, threshold);
        let markers = cluster_markers(&diff_pixels, 200, 1, 300.0);
        (diff_buf, diff_count, markers, 0.0)
    } else {
        let (heatmap_buf, high_density_count, high_pixels) =
            diff_heatmap_core(rgba_a.as_raw(), rgba_b.as_raw(), diff_w, diff_h, threshold);
        let markers = cluster_markers(&high_pixels, 250, 20, 80.0);
        let diff_probability = heatmap_diff_probability(high_density_count, diff_w, diff_h);
        (heatmap_buf, high_density_count, markers, diff_probability)
    };

    // 表示用エンコード: src_a は PSD、src_b は ref、processed_a は「PSDを揃えた絵」
    let processed_a_to_encode: DynamicImage = if anchor_is_psd {
        psd_img.clone()
    } else {
        processed_mover.clone()
    };

    let cache_a = format!("psdpdf_a_{}", versioned_path_key(&psd_path));
    let cache_b = format!("psdpdf_b_{}_p{}", versioned_path_key(&ref_path), page);
    let cache_pa = format!(
        "psdpdf_auto_pa_{}_{}_{}_p{}_{}_{}_{}",
        versioned_path_key(&psd_path),
        versioned_path_key(&ref_path),
        if anchor_is_psd { "psd" } else { "ref" },
        page,
        (best_scale * 10000.0) as i32,
        final_offset_x,
        final_offset_y
    );
    let cache_d = format!(
        "psdpdf_auto_{}_d_{}_{}_{}_p{}_{}_{}_{}",
        if use_simple_diff { "simple" } else { "heatmap" },
        versioned_path_key(&psd_path),
        versioned_path_key(&ref_path),
        if anchor_is_psd { "psd" } else { "ref" },
        page,
        (best_scale * 10000.0) as i32,
        final_offset_x,
        final_offset_y
    );
    let ((src_a_result, src_b_result), (processed_a_result, diff_result)) = rayon::join(
        || {
            rayon::join(
                || encode_to_jpeg_temp(&psd_img, &cache_a),
                || encode_to_jpeg_temp(&ref_img, &cache_b),
            )
        },
        || {
            rayon::join(
                || encode_to_jpeg_temp(&processed_a_to_encode, &cache_pa),
                || encode_rgba_to_png_temp(&diff_buf, diff_w, diff_h, &cache_d),
            )
        },
    );

    Ok(AutoAlignResult {
        best_scale,
        best_offset_x: final_offset_x,
        best_offset_y: final_offset_y,
        src_a: src_a_result?,
        src_b: src_b_result?,
        processed_a: processed_a_result?,
        diff_src: diff_result?,
        has_diff: diff_count > 0,
        diff_probability,
        high_density_count: diff_count,
        markers,
        image_width: diff_w,
        image_height: diff_h,
    })
}

// PDFの指定ページを画像としてレンダリング（並列ビュー用）
#[derive(Serialize)]
struct PdfPageImage {
    src: String,
    width: u32,
    height: u32,
}

#[tauri::command]
fn render_pdf_page(
    path: String,
    page: u32,
    dpi: f32,
    split_side: Option<String>,
) -> Result<PdfPageImage, String> {
    ensure_allowed_read(&path)?;
    let pdfium = get_pdfium()?;
    // 並列ビュー表示用なので print quality を無効化（速度優先）
    let (samples, width, height) = render_pdf_page_pdfium(&pdfium, &path, page, dpi, false)?;

    // 見開き分割: 左右半分を切り出し
    if let Some(ref side) = split_side {
        let half_width = width / 2;
        let offset_x = if side == "right" { half_width } else { 0 };
        let mut split_buf = vec![0u8; (half_width as usize) * (height as usize) * 4];
        for y in 0..height as usize {
            let src_offset = (y * width as usize + offset_x as usize) * 4;
            let dst_offset = y * half_width as usize * 4;
            split_buf[dst_offset..dst_offset + half_width as usize * 4]
                .copy_from_slice(&samples[src_offset..src_offset + half_width as usize * 4]);
        }
        let split_img: ImageBuffer<Rgba<u8>, Vec<u8>> =
            ImageBuffer::from_raw(half_width, height, split_buf)
                .ok_or_else(|| "Failed to create split image buffer".to_string())?;
        let cache_key = format!("pdfpage_{}_p{}_{}", versioned_path_key(&path), page, side);
        let src = encode_to_jpeg_temp(&DynamicImage::ImageRgba8(split_img), &cache_key)?;
        return Ok(PdfPageImage {
            src,
            width: half_width,
            height,
        });
    }

    let full_img: ImageBuffer<Rgba<u8>, Vec<u8>> = ImageBuffer::from_raw(width, height, samples)
        .ok_or_else(|| "Failed to create image buffer".to_string())?;
    let cache_key = format!("pdfpage_{}_p{}", versioned_path_key(&path), page);
    let src = encode_to_jpeg_temp(&DynamicImage::ImageRgba8(full_img), &cache_key)?;
    Ok(PdfPageImage { src, width, height })
}

// PDFの総ページ数を取得
#[tauri::command]
fn get_pdf_page_count(path: String) -> Result<u32, String> {
    ensure_allowed_read(&path)?;
    let pdfium = get_pdfium()?;
    let doc = pdfium
        .load_pdf_from_file(&path, None)
        .map_err(|e| format!("Failed to open PDF '{}': {}", path, e))?;
    Ok(doc.pages().len() as u32)
}

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn get_cli_args(state: State<'_, AppState>) -> Vec<String> {
    state.cli_args.clone()
}

fn unix_now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn utc_now_parts() -> (i64, usize, i64, u64, u64, u64) {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let time_of_day = secs % 86400;
    let hours = time_of_day / 3600;
    let minutes = (time_of_day % 3600) / 60;
    let seconds = time_of_day % 60;

    let mut year = 1970i64;
    let mut remaining_days = (secs / 86400) as i64;
    loop {
        let days_in_year = if (year % 4 == 0 && year % 100 != 0) || year % 400 == 0 {
            366
        } else {
            365
        };
        if remaining_days < days_in_year {
            break;
        }
        remaining_days -= days_in_year;
        year += 1;
    }

    let leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
    let month_days = [
        31,
        if leap { 29 } else { 28 },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    let mut month = 0usize;
    for (i, &days) in month_days.iter().enumerate() {
        if remaining_days < days as i64 {
            month = i;
            break;
        }
        remaining_days -= days as i64;
    }

    (year, month + 1, remaining_days + 1, hours, minutes, seconds)
}

fn utc_now_iso() -> String {
    let (year, month, day, hours, minutes, seconds) = utc_now_parts();
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.000Z",
        year, month, day, hours, minutes, seconds
    )
}

fn utc_today() -> String {
    let (year, month, day, _, _, _) = utc_now_parts();
    format!("{:04}-{:02}-{:02}", year, month, day)
}

fn normalize_path_text(path: &str) -> String {
    path.replace('/', "\\")
}

fn json_label_and_work(
    file_path: &str,
    data: Option<&serde_json::Value>,
) -> Option<(String, String)> {
    let path = Path::new(file_path);
    if path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("json"))
        != Some(true)
    {
        return None;
    }

    let normalized_path = normalize_path_text(file_path);
    let normalized_base = normalize_path_text(JSON_FOLDER_BASE_PATH);
    if !normalized_path
        .to_lowercase()
        .starts_with(&normalized_base.to_lowercase())
    {
        return None;
    }

    let relative = normalized_path
        .trim_start_matches(&normalized_base)
        .trim_start_matches('\\');
    let mut parts = relative.split('\\').filter(|part| !part.is_empty());
    let label = parts.next()?.to_string();
    let fallback_work = path
        .file_stem()
        .map(|stem| stem.to_string_lossy().to_string())
        .unwrap_or_default();
    let work = data
        .and_then(|value| {
            value
                .get("presetData")
                .and_then(|preset_data| preset_data.get("workInfo"))
                .and_then(|work_info| work_info.get("title"))
                .and_then(|title| title.as_str())
        })
        .filter(|title| !title.trim().is_empty())
        .map(|title| title.to_string())
        .unwrap_or(fallback_work);

    Some((label, work))
}

fn write_json_access_log(action: &str, file_path: &str, data: Option<&serde_json::Value>) {
    let Some((label_name, work_title)) = json_label_and_work(file_path, data) else {
        return;
    };

    let log_dir = Path::new(JSON_ACCESS_LOG_BASE_PATH);
    if let Err(error) = fs::create_dir_all(log_dir) {
        eprintln!("JSON access log folder create failed: {error}");
        return;
    }

    let log_path = log_dir.join(format!("json_access_{}.jsonl", utc_today()));
    let payload = serde_json::json!({
        "schemaVersion": 1,
        "occurredAt": utc_now_iso(),
        "occurredAtMs": unix_now_ms(),
        "appName": "KENBAN",
        "appVersion": env!("CARGO_PKG_VERSION"),
        "action": action,
        "labelName": label_name,
        "workTitle": work_title,
        "path": file_path,
        "userName": std::env::var("USERNAME").unwrap_or_default(),
        "userDomain": std::env::var("USERDOMAIN").unwrap_or_default(),
        "computerName": std::env::var("COMPUTERNAME").unwrap_or_default(),
    });

    let Ok(line) = serde_json::to_string(&payload) else {
        return;
    };

    match fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
    {
        Ok(mut file) => {
            let _ = writeln!(file, "{line}");
        }
        Err(error) => eprintln!("JSON access log write failed: {error}"),
    }
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    ensure_allowed_read(&path)?;
    let content =
        std::fs::read_to_string(&path).map_err(|e| format!("ファイル読み込みエラー: {}", e))?;
    let parsed = serde_json::from_str::<serde_json::Value>(&content).ok();
    write_json_access_log("read", &path, parsed.as_ref());
    Ok(content)
}

#[tauri::command]
fn write_text_file(path: String, content: String) -> Result<(), String> {
    ensure_allowed_write(&path)?;
    std::fs::write(&path, content.as_bytes())
        .map_err(|e| format!("ファイル書き込みエラー: {}", e))?;
    let parsed = serde_json::from_str::<serde_json::Value>(&content).ok();
    write_json_access_log("write", &path, parsed.as_ref());
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let args: Vec<String> = std::env::args().collect();
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(AppState {
            image_cache: Mutex::new(ImageCache::new(100)), // 最大100件キャッシュ
            cli_args: args,
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            parse_psd,
            open_file_with_default_app,
            open_file_in_photoshop,
            open_file_in_comic_bridge,
            save_screenshot,
            open_folder,
            decode_and_resize_image,
            preload_images,
            clear_image_cache,
            list_files_in_folder,
            open_pdf_in_mojiq,
            compute_diff_simple,
            compute_diff_heatmap,
            compute_diff_color_mono,
            check_diff_simple,
            check_diff_heatmap,
            check_diff_color_mono,
            compute_pdf_diff,
            compute_diff_psd_pdf,
            check_diff_psd_pdf,
            auto_align_psd_pdf,
            render_pdf_page,
            get_pdf_page_count,
            get_cli_args,
            read_text_file,
            write_text_file,
            cleanup_preview_cache,
            pick_files,
            pick_folder,
            pick_save_file
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            // 固定業務フォルダ・アプリ専用Temp・CLI引数などの信頼ルートを許可リストへ登録
            seed_trusted_roots(&handle);

            // 実ドラッグ&ドロップ（OSからメインプロセスへ直接渡るパス）を信頼入口として登録。
            // Renderer 由来の文字列ではなく Tauri コアのイベントなので XSS から悪用できない。
            if let Some(win) = app.get_webview_window("main") {
                let drop_handle = handle.clone();
                win.on_window_event(move |event| {
                    if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop {
                        paths, ..
                    }) = event
                    {
                        for p in paths {
                            let s = p.to_string_lossy();
                            if p.is_dir() {
                                register_allowed_dir(&drop_handle, &s);
                            } else {
                                register_allowed_file(&drop_handle, &s);
                            }
                        }
                    }
                });
            }

            // devtools は本番ビルドに同梱しない（Cargo.toml の devtools feature を撤去済み）。
            // 開発(debug)ビルドでは Tauri が devtools を利用可能にするため、F12/右クリックで開ける。
            #[cfg(debug_assertions)]
            {
                if let Some(window) = app.get_webview_window("main") {
                    window.open_devtools();
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
