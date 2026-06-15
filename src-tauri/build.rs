//! ビルド時に同梱 pdfium.dll の SHA-256 を exe へ焼き込む（改ざん検知・手順書 03_/12_ §5）。
//! 実行時 integrity.rs が bind_to_library の前に照合し、差し替えられた DLL のロードを拒否する。
use sha2::{Digest, Sha256};
use std::{fs, path::Path};

fn sha256_hex(path: &Path) -> Option<String> {
    let data = fs::read(path).ok()?;
    let mut h = Sha256::new();
    h.update(&data);
    Some(h.finalize().iter().map(|b| format!("{:02x}", b)).collect())
}

fn main() {
    let dir = std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR");
    let pdfium = Path::new(&dir).join("pdfium.dll");
    println!("cargo:rerun-if-changed=pdfium.dll");

    // ★ fail-closed: 同梱 pdfium.dll が無ければビルド中止（空マニフェスト＝ゲート無効化を防ぐ）
    let hash = sha256_hex(&pdfium).unwrap_or_else(|| {
        panic!("integrity build: pdfium.dll をハッシュ化できません（{}）", pdfium.display())
    });

    let out = std::env::var("OUT_DIR").expect("OUT_DIR");
    let src = format!("pub static PDFIUM_SHA256: &str = {:?};\n", hash);
    fs::write(Path::new(&out).join("integrity_manifest.rs"), src).expect("write manifest");

    tauri_build::build();
}
