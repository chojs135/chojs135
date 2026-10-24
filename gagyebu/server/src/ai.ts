import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import ExcelJS from "exceljs";
import { z } from "zod";
import type { Category } from "./db.js";

const client = new Anthropic();
const MODEL = process.env.CLAUDE_MODEL ?? "claude-opus-5-5";

export type UploadedFile = { buffer: Buffer; mimetype: string; originalname: string };

export type ExtractedTx = {
  date: string;
  type: "expense" | "income" | "transfer";
  amount: number;
  merchant: string;
  description: string;
  category: string;
  subcategory: string;
  payment_method: string;
  confidence: number;
  note: string;
};

export type Extraction = { document_type: string; summary: string; transactions: ExtractedTx[] };

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
type ImageType = (typeof IMAGE_TYPES)[number];

async function xlsxToCsv(buffer: Buffer): Promise<string> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const parts: string[] = [];
  wb.eachSheet((sheet) => {
    parts.push(`### 시트: ${sheet.name}`);
    sheet.eachRow((row) => {
      const values = (row.values as unknown[]).slice(1).map((v) => {
        if (v instanceof Date) return v.toISOString().slice(0, 10);
        if (v && typeof v === "object" && "text" in v) return String((v as { text: unknown }).text);
        if (v && typeof v === "object" && "result" in v) return String((v as { result: unknown }).result);
        return v == null ? "" : String(v);
      });
      parts.push(values.map((s) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)).join(","));
    });
  });
  return parts.join("\n");
}

async function toContentBlocks(file: UploadedFile): Promise<Anthropic.Beta.BetaContentBlockParam[]> {
  const label: Anthropic.Beta.BetaTextBlockParam = { type: "text", text: `[파일: ${file.originalname}]` };
  const mime = file.mimetype.toLowerCase();
  const name = file.originalname.toLowerCase();

  if (mime === "application/pdf" || name.endsWith(".pdf")) {
    return [
      label,
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: file.buffer.toString("base64") } },
    ];
  }
  if ((IMAGE_TYPES as readonly string[]).includes(mime)) {
    return [
      label,
      { type: "image", source: { type: "base64", media_type: mime as ImageType, data: file.buffer.toString("base64") } },
    ];
  }
  if (name.endsWith(".xlsx")) {
    return [{ type: "text", text: `${label.text}\n${await xlsxToCsv(file.buffer)}` }];
  }
  if (mime.startsWith("text/") || name.endsWith(".csv") || name.endsWith(".txt")) {
    return [{ type: "text", text: `${label.text}\n${decodeText(file.buffer)}` }];
  }
  throw new Error(`지원하지 않는 파일 형식입니다: ${file.originalname} (PDF, JPG/PNG/WEBP, CSV, XLSX 가능)`);
}

// 국내 은행 CSV는 아직 EUC-KR(CP949)로 내려오는 경우가 많다.
function decodeText(buffer: Buffer): string {
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  if (!utf8.includes("�")) return utf8;
  return new TextDecoder("euc-kr").decode(buffer);
}

function buildSystemPrompt(categories: Category[], rules: { keyword: string; category: string; subcategory: string }[]) {
  const cats = (type: string) =>
    categories
      .filter((c) => c.type === type)
      .map((c) => `- ${c.name}${c.subcategories.length ? `: ${c.subcategories.join(", ")}` : ""}`)
      .join("\n");

  return `당신은 한국 가정의 가계부 정리를 돕는 회계 도우미입니다. 사용자가 올린 은행/카드 거래내역서(PDF·엑셀·CSV), 영수증, 아파트 관리비 고지서, 급여명세서 등의 스크린샷이나 문서에서 거래를 빠짐없이 뽑아 분류합니다.

## 분류 기준
type은 셋 중 하나입니다.
- expense(지출): 실제로 돈을 쓴 것.
- income(수입): 급여, 이자, 환급 등 들어온 돈.
- transfer(이체): 가계의 순자산이 변하지 않는 돈의 이동. 통계에서 제외됩니다. 신용카드 대금 출금, 본인/배우자 명의 계좌 간 이체, 적금·저축·투자 계좌로 이체, 대출 원금 상환이 여기에 해당합니다. 카드대금을 지출로 잡으면 카드 내역과 이중으로 집계되므로 반드시 transfer로 분류하세요.

category는 아래 목록의 이름 중 하나를 정확히 그대로 쓰고, subcategory는 해당 카테고리의 세부항목 중 하나(없으면 빈 문자열)를 씁니다.

지출 카테고리:
${cats("expense")}

수입 카테고리:
${cats("income")}

이체 카테고리:
${cats("transfer")}

${
  rules.length
    ? `## 이 가구가 직접 지정한 가맹점 규칙 (최우선 적용)\n${rules.map((r) => `- "${r.keyword}" → ${r.category}${r.subcategory ? ` / ${r.subcategory}` : ""}`).join("\n")}\n`
    : ""
}
## 문서 유형별 처리
- 은행/카드 거래내역: 한 줄이 한 거래입니다. 출금은 expense 또는 transfer, 입금은 income 또는 transfer입니다. 승인 취소(취소/환불) 건은 원거래와 상쇄되도록 income/환급/지원금/환불로 기록하세요. 잔액, 합계, 소계 줄은 거래가 아니므로 제외합니다.
- 아파트 관리비 고지서: 항목별(일반관리비, 전기료, 수도료, 난방비, 급탕비, 경비비, 청소비 등)로 나눠 각각 주거/관리비 아래의 알맞은 세부항목으로 기록하세요. 전기·수도·가스/난방이 아닌 공용 항목은 "관리비"로 묶어 하나로 합쳐도 됩니다. 항목 합계는 고지서의 당월 부과액과 같아야 합니다. 날짜는 납부 마감일(없으면 고지 월의 말일)을 씁니다. 연체료·미납액 같은 이전 달 금액은 제외합니다.
- 영수증: 결제 1건을 하나의 거래로 기록합니다. 품목이 여러 카테고리에 걸쳐 크게 나뉘면(예: 마트에서 식료품과 가전) 나눠도 됩니다.
- 급여명세서: 실수령액을 급여 수입 1건으로 기록합니다.

## 형식
- date는 YYYY-MM-DD. 연도가 없으면 문서의 다른 날짜나 오늘(${new Date().toISOString().slice(0, 10)})을 기준으로 가장 그럴듯한 연도를 고릅니다.
- amount는 원 단위의 양의 정수입니다(부호는 type으로 표현).
- merchant는 가맹점/상대방 이름을 문서에 적힌 그대로, description은 무엇에 쓴 돈인지 짧은 한국어 설명입니다.
- payment_method는 카드사/은행/결제수단 이름(예: "신한카드", "국민은행 입출금", "현금")이고 모르면 빈 문자열입니다.
- confidence는 분류에 대한 확신도 0~1입니다. 읽기 어렵거나 추측이 섞이면 낮게 주고 note에 이유를 적습니다.
- document_type은 문서 종류(예: "카드 이용내역", "관리비 고지서"), summary는 한두 문장 요약(기간, 건수, 합계)입니다.
- 문서에 거래가 없으면 transactions를 빈 배열로 두고 summary에 이유를 적습니다.`;
}

export async function extractTransactions(
  files: UploadedFile[],
  categories: Category[],
  rules: { keyword: string; category: string; subcategory: string }[],
): Promise<Extraction> {
  const names = categories.map((c) => c.name) as [string, ...string[]];
  const schema = z.object({
    document_type: z.string(),
    summary: z.string(),
    transactions: z.array(
      z.object({
        date: z.string(),
        type: z.enum(["expense", "income", "transfer"]),
        amount: z.number(),
        merchant: z.string(),
        description: z.string(),
        category: z.enum(names),
        subcategory: z.string(),
        payment_method: z.string(),
        confidence: z.number(),
        note: z.string(),
      }),
    ),
  });

  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const f of files) content.push(...(await toContentBlocks(f)));
  content.push({ type: "text", text: "위 자료에서 모든 거래를 추출하고 분류해 주세요." });

  const response = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 32000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: betaZodOutputFormat(schema) },
    system: buildSystemPrompt(categories, rules),
    messages: [{ role: "user", content }],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("AI가 이 문서의 처리를 거절했습니다. 다른 파일로 시도해 주세요.");
  }
  if (response.stop_reason === "max_tokens") {
    throw new Error("문서가 너무 커서 한 번에 처리하지 못했습니다. 기간을 나눠 올려 주세요.");
  }
  if (!response.parsed_output) throw new Error("AI 응답을 해석하지 못했습니다.");

  const out = response.parsed_output;
  return {
    ...out,
    transactions: out.transactions.map((t) => ({ ...t, amount: Math.round(Math.abs(t.amount)) })),
  };
}
