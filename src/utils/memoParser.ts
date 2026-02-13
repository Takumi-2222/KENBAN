// テキストメモ解析ユーティリティ
// ページ区切りの自動検出・分割を行う

interface DelimiterPattern {
  regex: RegExp;
  extractPage: (match: RegExpMatchArray) => number;
  sequential?: boolean; // true = ページ番号なし、出現順に連番
}

// ページ区切りパターン（優先順）
const DELIMITER_PATTERNS: DelimiterPattern[] = [
  // <<2Page>>, <<2>>, << 2Page >>, <<2P>>
  { regex: /^<<\s*(\d{1,4})\s*(?:Page|[Pp]age|[Pp])?\s*>>\s*$/m, extractPage: m => parseInt(m[1], 10) },
  // [1巻18P], [第3話5P] — COMIC-POT/COMIC-Bridge形式 (プレフィクス+ページ番号)
  { regex: /^\[(?:.*\D)(\d{1,4})\s*[Pp]\]\s*$/m, extractPage: m => parseInt(m[1], 10) },
  // P01, P1, p01, p1
  { regex: /^[Pp]\.?(\d{1,4})\s*$/m, extractPage: m => parseInt(m[1], 10) },
  // 【1ページ】【1P】【P1】
  { regex: /^[【\[](?:[Pp]\.?)?(\d{1,4})(?:ページ|[Pp])?[】\]]\s*$/m, extractPage: m => parseInt(m[1], 10) },
  // ---1--- や === 1 === や *** 1 ***
  { regex: /^[-=*]{2,}\s*(\d{1,4})\s*[-=*]{2,}\s*$/m, extractPage: m => parseInt(m[1], 10) },
  // #1, #01
  { regex: /^#(\d{1,4})\s*$/m, extractPage: m => parseInt(m[1], 10) },
  // 001, 01 (行頭の数字のみの行)
  { regex: /^(\d{2,4})\s*$/m, extractPage: m => parseInt(m[1], 10) },
  // 1ページ, 1P
  { regex: /^(\d{1,4})\s*(?:ページ|[Pp])\s*$/m, extractPage: m => parseInt(m[1], 10) },
  // ---------- (ダッシュ/イコール/アスタリスクのみの区切り線8本以上、ページ番号なし → 連番)
  { regex: /^[-]{8,}\s*$/m, extractPage: () => 0, sequential: true },
  { regex: /^[=]{8,}\s*$/m, extractPage: () => 0, sequential: true },
  { regex: /^[*]{8,}\s*$/m, extractPage: () => 0, sequential: true },
];

/**
 * テキストメモを解析してページ番号→テキストのマップを返す
 */
export function parseMemo(text: string): Map<number, string> {
  // COMIC-POT/COMIC-Bridgeヘッダー行を除去
  const cleaned = text.replace(/^\[COMIC-POT:[^\]]*\]\s*\n?/m, '');

  const pattern = detectDelimiterPattern(cleaned);

  if (pattern) {
    return splitByPattern(cleaned, pattern);
  }

  // フォールバック: 空行2連続で区切り
  return splitByDoubleNewline(cleaned);
}

/**
 * テキストからページ区切りパターンを自動検出する
 */
export function detectDelimiterPattern(text: string): DelimiterPattern | null {
  let bestPattern: DelimiterPattern | null = null;
  let bestCount = 0;
  let bestIsSequential = false;

  for (const pattern of DELIMITER_PATTERNS) {
    const globalRegex = new RegExp(pattern.regex.source, 'gm');
    const matches = [...text.matchAll(globalRegex)];
    if (matches.length >= 2) {
      const isSeq = !!pattern.sequential;
      // 番号付きパターンを連番パターンより優先（同数の場合）
      if (matches.length > bestCount || (matches.length === bestCount && bestIsSequential && !isSeq)) {
        bestPattern = pattern;
        bestCount = matches.length;
        bestIsSequential = isSeq;
      }
    }
  }

  return bestPattern;
}

/**
 * 検出したパターンでテキストを分割する
 */
function splitByPattern(text: string, pattern: DelimiterPattern): Map<number, string> {
  const result = new Map<number, string>();
  const globalRegex = new RegExp(pattern.regex.source, 'gm');
  const matches = [...text.matchAll(globalRegex)];

  if (matches.length === 0) return result;

  // 最初のデリミタの前にテキストがあれば追加
  const preText = text.slice(0, matches[0].index!).trim();
  const hasPreText = preText.length > 0;

  if (hasPreText) {
    if (pattern.sequential) {
      result.set(1, preText); // 連番モード: 前テキストを1ページ目に
    } else {
      const firstPage = pattern.extractPage(matches[0]);
      result.set(Math.max(1, firstPage - 1), preText);
    }
  }

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    // 連番モード: preTextがあれば2から、なければ1から
    const pageNum = pattern.sequential ? i + 1 + (hasPreText ? 1 : 0) : pattern.extractPage(match);
    const startPos = match.index! + match[0].length;
    const endPos = i < matches.length - 1 ? matches[i + 1].index! : text.length;
    const pageText = text.slice(startPos, endPos).trim();
    // 空セクションもページとして保持（セリフなしページ）
    result.set(pageNum, pageText);
  }

  return result;
}

/**
 * 空行2連続でページ区切り（フォールバック）
 */
function splitByDoubleNewline(text: string): Map<number, string> {
  const result = new Map<number, string>();
  const sections = text.split(/\n\s*\n\s*\n/);

  sections.forEach((section, index) => {
    const trimmed = section.trim();
    if (trimmed) {
      result.set(index + 1, trimmed);
    }
  });

  return result;
}

/**
 * PSDファイル名からページ番号を抽出する
 */
export function matchPageToFile(fileName: string): number | null {
  // ファイル名から拡張子を除去
  const name = fileName.replace(/\.[^.]+$/, '');

  // パターン: P001, p01, P1 など
  const pMatch = name.match(/[Pp]\.?0*(\d+)/);
  if (pMatch) return parseInt(pMatch[1], 10);

  // パターン: 末尾の数字 (例: manga_001, 001, page001)
  const numMatch = name.match(/0*(\d+)$/);
  if (numMatch) return parseInt(numMatch[1], 10);

  // パターン: 先頭の数字 (例: 001_text)
  const leadMatch = name.match(/^0*(\d+)/);
  if (leadMatch) return parseInt(leadMatch[1], 10);

  return null;
}
