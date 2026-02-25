// テキストメモ解析ユーティリティ
// ページ区切りの自動検出・分割を行う

interface DelimiterPattern {
  regex: RegExp;
  extractPage: (match: RegExpMatchArray) => number;
  extractPages?: (match: RegExpMatchArray) => number[];  // 複数ページ区切り
  sequential?: boolean; // true = ページ番号なし、出現順に連番
}

export interface MemoSectionRange {
  pageNums: number[];
  text: string;           // trimmed content
  rangeStart: number;     // デリミタ直後の位置 (inclusive, cleaned text内)
  rangeEnd: number;       // 次のデリミタ直前 or 末尾 (exclusive, cleaned text内)
}

export interface ParsedMemo {
  pages: Map<number, string>;
  sharedPages: Map<number, number[]>;  // pageNum → そのセクションの全ページ番号リスト
  sections: MemoSectionRange[];        // 位置情報付きセクション（編集用）
}

// ページ区切りパターン（優先順）
const DELIMITER_PATTERNS: DelimiterPattern[] = [
  // <<1,2Page>>, <<3,4Page>> — クリスタ export形式（2ページ単位）
  {
    regex: /^<<\s*(\d{1,4})\s*,\s*(\d{1,4})\s*(?:Page|[Pp]age|[Pp])?\s*>>\s*$/m,
    extractPage: m => parseInt(m[1], 10),
    extractPages: m => [parseInt(m[1], 10), parseInt(m[2], 10)],
  },
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
export function parseMemo(text: string): ParsedMemo {
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
function splitByPattern(text: string, pattern: DelimiterPattern): ParsedMemo {
  const result = new Map<number, string>();
  const sharedPages = new Map<number, number[]>();
  const sections: MemoSectionRange[] = [];
  const globalRegex = new RegExp(pattern.regex.source, 'gm');
  const matches = [...text.matchAll(globalRegex)];

  if (matches.length === 0) return { pages: result, sharedPages, sections };

  // 最初のデリミタの前にテキストがあれば追加
  const preText = text.slice(0, matches[0].index!).trim();
  const hasPreText = preText.length > 0;

  if (hasPreText) {
    const preRangeStart = 0;
    const preRangeEnd = matches[0].index!;
    if (pattern.sequential) {
      result.set(1, preText);
      sections.push({ pageNums: [1], text: preText, rangeStart: preRangeStart, rangeEnd: preRangeEnd });
    } else {
      const firstPage = pattern.extractPage(matches[0]);
      const pageNum = Math.max(1, firstPage - 1);
      result.set(pageNum, preText);
      sections.push({ pageNums: [pageNum], text: preText, rangeStart: preRangeStart, rangeEnd: preRangeEnd });
    }
  }

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const startPos = match.index! + match[0].length;
    const endPos = i < matches.length - 1 ? matches[i + 1].index! : text.length;
    const pageText = text.slice(startPos, endPos).trim();

    if (pattern.sequential) {
      const pageNum = i + 1 + (hasPreText ? 1 : 0);
      result.set(pageNum, pageText);
      sections.push({ pageNums: [pageNum], text: pageText, rangeStart: startPos, rangeEnd: endPos });
    } else if (pattern.extractPages) {
      // 複数ページ区切り: 全ページに同じテキストをセット
      const pageNums = pattern.extractPages(match);
      for (const pn of pageNums) {
        result.set(pn, pageText);
        sharedPages.set(pn, pageNums);
      }
      sections.push({ pageNums: [...pageNums], text: pageText, rangeStart: startPos, rangeEnd: endPos });
    } else {
      const pageNum = pattern.extractPage(match);
      result.set(pageNum, pageText);
      sections.push({ pageNums: [pageNum], text: pageText, rangeStart: startPos, rangeEnd: endPos });
    }
  }

  return { pages: result, sharedPages, sections };
}

/**
 * 空行2連続でページ区切り（フォールバック）
 */
function splitByDoubleNewline(text: string): ParsedMemo {
  const result = new Map<number, string>();
  const sections: MemoSectionRange[] = [];
  const regex = /\n\s*\n\s*\n/g;
  let lastEnd = 0;
  let pageNum = 1;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const sectionText = text.slice(lastEnd, match.index).trim();
    if (sectionText) {
      result.set(pageNum, sectionText);
      sections.push({ pageNums: [pageNum], text: sectionText, rangeStart: lastEnd, rangeEnd: match.index });
      pageNum++;
    }
    lastEnd = match.index + match[0].length;
  }

  // 最後のセクション
  const lastSection = text.slice(lastEnd).trim();
  if (lastSection) {
    result.set(pageNum, lastSection);
    sections.push({ pageNums: [pageNum], text: lastSection, rangeStart: lastEnd, rangeEnd: text.length });
  }

  return { pages: result, sharedPages: new Map(), sections };
}

/**
 * PSDファイル名からページ番号を抽出する
 */
export interface MemoSection {
  pageNums: number[];
  text: string;
}

/**
 * ParsedMemoからユニークなメモセクションを抽出する
 * 共有ページ（<<1,2Page>>等）は1つのセクションにまとめる
 */
export function getUniqueMemoSections(parsedMemo: ParsedMemo): MemoSection[] {
  const seen = new Set<string>();
  const sections: MemoSection[] = [];

  for (const [pageNum, text] of parsedMemo.pages) {
    const sharedGroup = parsedMemo.sharedPages.get(pageNum);
    const key = sharedGroup ? [...sharedGroup].sort((a, b) => a - b).join(',') : String(pageNum);

    if (!seen.has(key)) {
      seen.add(key);
      sections.push({
        pageNums: sharedGroup ? [...sharedGroup].sort((a, b) => a - b) : [pageNum],
        text,
      });
    }
  }

  return sections;
}

/**
 * メモのセクションテキストを差し替える
 * デリミタ構造を保持しつつ、指定ページのコンテンツだけを書き換える
 */
export function replaceMemoSection(
  raw: string,
  sections: MemoSectionRange[],
  pageNum: number,
  newText: string
): string {
  const section = sections.find(s => s.pageNums.includes(pageNum));
  if (!section) return raw;
  const rawSlice = raw.slice(section.rangeStart, section.rangeEnd);
  const leadingWS = rawSlice.match(/^(\s*)/)?.[1] || '\n';
  const trailingWS = rawSlice.match(/(\s*)$/)?.[1] || '\n';
  return raw.slice(0, section.rangeStart)
    + leadingWS + newText.trim() + trailingWS
    + raw.slice(section.rangeEnd);
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
