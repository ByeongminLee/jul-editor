import type { Block, Doc, Inline } from "@jul-editor/core";

// Sample document for the DOCX editor showcase: a Non-Disclosure Agreement template. Square-bracket
// placeholders such as [Effective Date] are turned into highlighted runs so they stand out like the
// fill-in fields of a real template. Sections are numbered by hand ("1.", "1.1") so the numbers
// survive a .docx round trip, which does not carry the editor's automatic list numbering.

const PLACEHOLDER = /(\[[^\]]+\])/g;

/** "text with [Placeholder]" -> text runs, placeholders highlighted, optional bold on the plain text. */
function runs(text: string, bold = false): Inline[] {
  return text.split(PLACEHOLDER).filter(Boolean).map((part) => {
    const marks: { type: string; attrs?: Record<string, string> }[] = [];
    if (bold) marks.push({ type: "bold" });
    if (PLACEHOLDER.test(part)) marks.push({ type: "highlight", attrs: { color: "yellow" } });
    PLACEHOLDER.lastIndex = 0;
    return marks.length ? { type: "text", text: part, marks } : { type: "text", text: part };
  }) as Inline[];
}

let seq = 0;
const id = () => `docx-${++seq}`;
const p = (text: string, props: Record<string, string> = {}): Block => ({ id: id(), type: "paragraph", props, content: runs(text) });
const h = (level: 1 | 2 | 3, text: string, props: Record<string, string> = {}): Block => ({ id: id(), type: "heading", props: { level, ...props }, content: runs(text) });
const li = (text: string): Block => ({ id: id(), type: "bulletListItem", props: {}, content: runs(text) });
const pageBreak = (): Block => ({ id: id(), type: "pageBreak", props: {} });
/** A clause: bold lead-in ("1.1 Purpose.") followed by plain text. */
const clause = (num: string, lead: string, text: string): Block => ({ id: id(), type: "paragraph", props: {}, content: [...runs(`${num} ${lead}`, true), ...runs(` ${text}`)] });

export function docxSampleDoc(locale: "en" | "ko"): Doc {
  seq = 0;
  const blocks = locale === "ko" ? ko() : en();
  return { version: 1, blocks };
}

function en(): Block[] {
  return [
    h(1, "Non-Disclosure Agreement", { textAlign: "center" }),
    p("This Non-Disclosure Agreement (the \"Agreement\") is entered into as of [Effective Date] (the \"Effective Date\") by and between [Disclosing Party Name], a company organized under the laws of [Jurisdiction], with its principal office at [Disclosing Party Address] (the \"Disclosing Party\"), and [Receiving Party Name], with its principal office at [Receiving Party Address] (the \"Receiving Party\"). Each may be referred to as a \"Party\" and together as the \"Parties\"."),
    h(2, "1. Purpose"),
    clause("1.1", "Business purpose.", "The Parties wish to explore [Business Purpose] (the \"Purpose\"). In connection with the Purpose, the Disclosing Party may share certain confidential and proprietary information with the Receiving Party."),
    clause("1.2", "Limited use.", "The Receiving Party will use the Confidential Information solely to evaluate and pursue the Purpose and for no other reason."),
    clause("1.3", "No obligation.", "Nothing in this Agreement obliges either Party to disclose any particular information or to enter into any further transaction."),
    h(2, "2. Definitions"),
    clause("2.1", "Confidential Information.", "means any non-public information, in any form, disclosed by or on behalf of the Disclosing Party, including technical data, designs, source code, business plans, customer lists, pricing and financial information, that is marked confidential or that a reasonable person would understand to be confidential."),
    clause("2.2", "Exclusions.", "Confidential Information does not include information that:"),
    li("is or becomes publicly available through no fault of the Receiving Party;"),
    li("was already known to the Receiving Party before disclosure, as shown by written records;"),
    li("is independently developed by the Receiving Party without use of the Confidential Information; or"),
    li("is rightfully received from a third party without a duty of confidentiality."),
    h(2, "3. Obligations of the Receiving Party"),
    clause("3.1", "Standard of care.", "The Receiving Party will protect the Confidential Information with at least the same degree of care it uses for its own confidential information, and never less than reasonable care."),
    clause("3.2", "Non-disclosure.", "The Receiving Party will not disclose the Confidential Information to any third party, except to its employees, advisers and contractors who need to know it for the Purpose and who are bound by written confidentiality obligations no less protective than those in this Agreement."),
    clause("3.3", "Compelled disclosure.", "If the Receiving Party is legally compelled to disclose Confidential Information, it will give the Disclosing Party prompt written notice, where lawful, so that the Disclosing Party may seek a protective order."),
    clause("3.4", "Notice of breach.", "The Receiving Party will notify the Disclosing Party within [Notice Period] days of becoming aware of any unauthorized use or disclosure."),
    h(2, "4. Term and Termination"),
    clause("4.1", "Term.", "This Agreement begins on the Effective Date and continues for [Term Length] years, unless terminated earlier by either Party on thirty (30) days' written notice."),
    clause("4.2", "Survival.", "The obligations of confidentiality survive termination or expiry for [Survival Period] years, and for as long as any trade secret remains a trade secret under applicable law."),
    h(2, "5. Return or Destruction"),
    p("Within ten (10) days of a written request, the Receiving Party will return or securely destroy all Confidential Information, including copies and derivatives, and confirm in writing that it has done so. One archival copy may be kept only where retention is required by law."),
    h(2, "6. Ownership and No License"),
    p("All Confidential Information remains the property of the Disclosing Party. No license or other right in any patent, copyright, trade secret or other intellectual property is granted by this Agreement, except the limited right to use Confidential Information for the Purpose."),
    h(2, "7. Remedies"),
    p("The Receiving Party acknowledges that unauthorized use or disclosure may cause irreparable harm for which damages are an inadequate remedy. The Disclosing Party may therefore seek injunctive relief in addition to any other remedy available at law or in equity, without posting a bond."),
    h(2, "8. General"),
    clause("8.1", "Governing law.", "This Agreement is governed by the laws of [Governing Law], without regard to its conflict of laws rules. The courts of [Venue] have exclusive jurisdiction over any dispute arising from it."),
    clause("8.2", "Entire agreement.", "This Agreement is the entire agreement of the Parties on its subject matter and may be amended only in a writing signed by both Parties."),
    clause("8.3", "Severability and waiver.", "If any provision is held unenforceable, the remainder stays in effect. A failure to enforce a right is not a waiver of that right."),
    clause("8.4", "Counterparts.", "This Agreement may be signed in counterparts, including by electronic signature, each of which is an original."),
    pageBreak(),
    h(2, "Signatures"),
    p("The Parties have executed this Agreement as of the Effective Date."),
    p("[Disclosing Party Name]", { textAlign: "left" }),
    p("By: ______________________________"),
    p("Name: [Signatory Name]"),
    p("Title: [Signatory Title]"),
    p("Date: [Signature Date]"),
    p(" "),
    p("[Receiving Party Name]"),
    p("By: ______________________________"),
    p("Name: [Signatory Name]"),
    p("Title: [Signatory Title]"),
    p("Date: [Signature Date]"),
  ];
}

function ko(): Block[] {
  return [
    h(1, "비밀유지계약서", { textAlign: "center" }),
    p("본 비밀유지계약(이하 \"본 계약\")은 [효력 발생일](이하 \"효력 발생일\")에 [관할 국가]의 법률에 따라 설립되어 [정보 제공자 주소]에 주된 사무소를 둔 [정보 제공자 명칭](이하 \"제공자\")과 [정보 수령자 주소]에 주된 사무소를 둔 [정보 수령자 명칭](이하 \"수령자\") 사이에 체결됩니다. 제공자와 수령자는 각각 \"당사자\", 합하여 \"양 당사자\"라 합니다."),
    h(2, "1. 목적"),
    clause("1.1", "사업 목적.", "양 당사자는 [사업 목적](이하 \"목적\")을 검토하고자 하며, 이와 관련하여 제공자는 수령자에게 비밀 정보 및 독점 정보를 제공할 수 있습니다."),
    clause("1.2", "사용 제한.", "수령자는 비밀 정보를 오직 목적을 평가하고 추진하기 위해서만 사용하며 그 밖의 어떠한 용도로도 사용하지 않습니다."),
    clause("1.3", "의무 없음.", "본 계약은 어느 당사자에게도 특정 정보를 제공하거나 추가 거래를 체결할 의무를 부과하지 않습니다."),
    h(2, "2. 정의"),
    clause("2.1", "비밀 정보.", "란 제공자 또는 그를 대리한 자가 형식을 불문하고 공개한 모든 비공개 정보로서 기술 자료, 설계, 소스 코드, 사업 계획, 고객 목록, 가격 및 재무 정보를 포함하며, 비밀로 표시되었거나 합리적인 사람이 비밀로 이해할 정보를 말합니다."),
    clause("2.2", "예외.", "다음 각 호의 정보는 비밀 정보에 포함되지 않습니다."),
    li("수령자의 귀책 없이 공지되었거나 공지된 정보"),
    li("공개 전에 이미 수령자가 알고 있었음이 서면 기록으로 입증되는 정보"),
    li("비밀 정보를 이용하지 않고 수령자가 독자적으로 개발한 정보"),
    li("비밀유지 의무가 없는 제3자로부터 적법하게 취득한 정보"),
    h(2, "3. 수령자의 의무"),
    clause("3.1", "주의 의무.", "수령자는 자신의 비밀 정보에 적용하는 것과 같은 수준 이상으로, 최소한 합리적인 주의를 다하여 비밀 정보를 보호합니다."),
    clause("3.2", "비공개.", "수령자는 목적상 알 필요가 있고 본 계약과 같은 수준 이상의 서면 비밀유지 의무를 지는 임직원, 자문가 및 계약자를 제외하고는 비밀 정보를 제3자에게 공개하지 않습니다."),
    clause("3.3", "강제 공개.", "수령자가 법령에 따라 비밀 정보의 공개를 요구받는 경우, 법이 허용하는 한 제공자가 보호명령을 신청할 수 있도록 즉시 서면으로 통지합니다."),
    clause("3.4", "위반 통지.", "수령자는 무단 사용 또는 공개 사실을 알게 된 날부터 [통지 기간]일 이내에 제공자에게 통지합니다."),
    h(2, "4. 기간 및 종료"),
    clause("4.1", "계약 기간.", "본 계약은 효력 발생일에 시작하여 [계약 기간]년간 유지되며, 어느 당사자든 30일 전 서면 통지로 먼저 종료할 수 있습니다."),
    clause("4.2", "존속.", "비밀유지 의무는 계약 종료 또는 만료 후에도 [존속 기간]년간, 그리고 영업비밀이 관련 법령상 영업비밀로 유지되는 동안 존속합니다."),
    h(2, "5. 반환 또는 파기"),
    p("수령자는 서면 요청을 받은 날부터 10일 이내에 사본과 파생물을 포함한 모든 비밀 정보를 반환하거나 안전하게 파기하고, 이를 서면으로 확인합니다. 법령상 보관이 요구되는 경우에 한하여 보관용 사본 1부를 유지할 수 있습니다."),
    h(2, "6. 소유권 및 사용권 불인정"),
    p("모든 비밀 정보는 제공자의 재산으로 남습니다. 본 계약은 목적을 위해 비밀 정보를 사용할 제한적 권리를 제외하고 특허, 저작권, 영업비밀 등 지식재산권에 대한 어떠한 사용권도 부여하지 않습니다."),
    h(2, "7. 구제 수단"),
    p("수령자는 무단 사용 또는 공개가 금전 배상으로 충분히 회복되지 않는 손해를 초래할 수 있음을 인정합니다. 따라서 제공자는 법률상 또는 형평법상 다른 구제 수단에 더하여 담보 제공 없이 금지명령을 구할 수 있습니다."),
    h(2, "8. 일반 조항"),
    clause("8.1", "준거법.", "본 계약은 법률 충돌 규정과 관계없이 [준거법]에 따르며, 본 계약에서 발생하는 분쟁은 [관할 법원]을 전속 관할로 합니다."),
    clause("8.2", "완전한 합의.", "본 계약은 그 대상에 관한 양 당사자의 완전한 합의이며 양 당사자가 서명한 서면으로만 변경할 수 있습니다."),
    clause("8.3", "일부 무효 및 권리 불포기.", "일부 조항이 집행 불가능하더라도 나머지 조항은 효력을 유지하며, 권리를 행사하지 않았다고 해서 그 권리를 포기한 것은 아닙니다."),
    clause("8.4", "계약서 부본.", "본 계약은 전자서명을 포함하여 여러 부본으로 서명할 수 있으며, 각 부본은 원본의 효력을 가집니다."),
    pageBreak(),
    h(2, "서명"),
    p("양 당사자는 효력 발생일에 본 계약을 체결하였습니다."),
    p("[정보 제공자 명칭]"),
    p("서명: ______________________________"),
    p("성명: [서명자 성명]"),
    p("직위: [서명자 직위]"),
    p("일자: [서명 일자]"),
    p(" "),
    p("[정보 수령자 명칭]"),
    p("서명: ______________________________"),
    p("성명: [서명자 성명]"),
    p("직위: [서명자 직위]"),
    p("일자: [서명 일자]"),
  ];
}
