// Simple Korean 초성(choseong/leading-consonant) search, nice-to-have:
// "/ㅊㅌ" should match "차트". Modern Hangul syllables (U+AC00..U+D7A3)
// decompose as base + (choseong*588 + jungseong*28 + jongseong); we only need
// the choseong index.
const CHOSEONG = ["ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];
const HANGUL_BASE = 0xac00;
const HANGUL_END = 0xd7a3;
const SYLLABLES_PER_CHOSEONG = 21 * 28;

export function toChoseong(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= HANGUL_BASE && code <= HANGUL_END) {
      const index = Math.floor((code - HANGUL_BASE) / SYLLABLES_PER_CHOSEONG);
      out += CHOSEONG[index];
    } else {
      out += ch;
    }
  }
  return out;
}

export function isChoseongQuery(query: string): boolean {
  return query.length > 0 && [...query].every((ch) => CHOSEONG.includes(ch));
}

export function matchesChoseong(query: string, text: string): boolean {
  if (!isChoseongQuery(query)) return false;
  return toChoseong(text).includes(query);
}
