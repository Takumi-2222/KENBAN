// セキュリティ回帰チェック（標準設計ガイドライン 5.4）
// 危険な変更（セキュリティの先祖返り）をビルド前に静的検出する。
// 実行: npm run check:security  (または npm.cmd run check:security)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const read = (rel) => {
  try {
    return readFileSync(resolve(root, rel), 'utf8');
  } catch {
    return '';
  }
};

const libRs = read('src-tauri/src/lib.rs');
const capabilities = read('src-tauri/capabilities/default.json');
const cargoToml = read('src-tauri/Cargo.toml');
const tauriConf = read('src-tauri/tauri.conf.json');

const failures = [];
const check = (label, ok) => {
  if (!ok) failures.push(label);
};

// 1. 任意パス登録APIが公開されていない（authorize_user_paths / allowPath / registerPath 等）
check(
  '任意パス登録API(authorize_user_paths等)が公開されていない',
  !/#\[tauri::command\][^]*?fn\s+(authorize_user_paths|allow_path|register_path|add_allowed_path)\b/.test(
    libRs
  )
);

// 2. 古い path 配列型 confirm API が残っていない
check(
  '旧 path 配列型 confirm API が存在しない',
  !/fn\s+confirm_file_picker_paths\b/.test(libRs)
);

// 3. fs スコープに広域許可(**)が静的付与されていない
check('capabilities の fs スコープに "**" が無い', !capabilities.includes('"**"'));

// 4. 本番(release)ビルドに devtools feature を同梱していない
check(
  'Cargo.toml の tauri features に devtools を含まない',
  !/tauri\s*=\s*\{[^}]*features\s*=\s*\[[^\]]*"devtools"/.test(cargoToml)
);

// 5. 利用系コマンドが許可判定(ensure_allowed_*)を通している
check('ensure_allowed_read による許可判定が実装されている', /fn\s+ensure_allowed_read\b/.test(libRs));
check('ensure_allowed_write による許可判定が実装されている', /fn\s+ensure_allowed_write\b/.test(libRs));
check(
  'read_text_file が許可判定を呼んでいる',
  /fn read_text_file[^]*?ensure_allowed_read/.test(libRs)
);
check(
  'write_text_file が許可判定を呼んでいる',
  /fn write_text_file[^]*?ensure_allowed_write/.test(libRs)
);

// 6. 保存ファイル名の厳格検証が実装・呼び出しされている
check('validate_file_name が実装されている', /fn\s+validate_file_name\b/.test(libRs));
check('validate_file_name が呼び出されている', /validate_file_name\(/.test(libRs) && (libRs.match(/validate_file_name\(/g) || []).length >= 2);

// 7. 信頼できる入口（Rust側ダイアログ）経由でのみ登録している
check('pick_files / pick_folder コマンドが存在する', /fn\s+pick_files\b/.test(libRs) && /fn\s+pick_folder\b/.test(libRs));
check('実D&Dを Rust 側で登録している (DragDropEvent::Drop)', /DragDropEvent::Drop/.test(libRs));

// 8. 外部 exe 起動が任意 exe を許さない（exe名検証）
check('外部exe起動の検証(validate_executable)が実装されている', /fn\s+validate_executable\b/.test(libRs));

// 9. CSP に最低限のハードニングディレクティブが含まれる
check("CSP に object-src 'none' が含まれる", /object-src 'none'/.test(tauriConf));
check("CSP に base-uri 'self' が含まれる", /base-uri 'self'/.test(tauriConf));

// 10. assetProtocol スコープが広域(**単独)でない
check(
  'assetProtocol スコープがアプリ専用Tempに限定されている',
  /kenban_preview/.test(tauriConf) && !/"\$TEMP\/\*\*"/.test(tauriConf)
);

if (failures.length > 0) {
  console.error('Security regression check FAILED:');
  for (const f of failures) console.error('  - NG: ' + f);
  process.exit(1);
}

console.log(`Security regression check passed: ${10}`);
