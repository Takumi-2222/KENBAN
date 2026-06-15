//! pdfium.dll 改ざん検知（手順書 03_/12_ §6）。build.rs が焼き込んだ期待ハッシュと照合する。
include!(concat!(env!("OUT_DIR"), "/integrity_manifest.rs")); // PDFIUM_SHA256
use sha2::{Digest, Sha256};
use std::path::Path;
use std::sync::OnceLock;

fn sha256_file(path: &Path) -> Option<String> {
    let data = std::fs::read(path).ok()?;
    let mut h = Sha256::new();
    h.update(&data);
    Some(h.finalize().iter().map(|b| format!("{:02x}", b)).collect())
}

/// pdfium.dll のハッシュを期待値と照合（初回成功はキャッシュ）。不一致ならロードを拒否。
pub fn verify_pdfium(path: &Path) -> Result<(), String> {
    static OK: OnceLock<bool> = OnceLock::new();
    if *OK.get().unwrap_or(&false) {
        return Ok(());
    }
    let actual = sha256_file(path).ok_or_else(|| "pdfium.dll を読めません".to_string())?;
    if actual.eq_ignore_ascii_case(PDFIUM_SHA256) {
        let _ = OK.set(true);
        eprintln!("[integrity] pdfium OK");
        Ok(())
    } else {
        Err("整合性NG: pdfium.dll が改ざん／別ファイルの可能性があります。安全のため処理を中止しました。"
            .to_string())
    }
}
