import assert from "node:assert/strict";

const model = "@cf/meta/llama-3.1-8b-instruct-fast";
const groups = ["mo_long", "ky_uc", "thau_hieu", "chan_that", "tuong_lai"];
const forms = [
  "ke_chuyen", "lua_chon", "tuong_tuong", "nhin_nguoi_kia", "nhin_ban_than",
  "hoan_thanh_cau", "biet_on", "mong_muon", "cam_giac", "hanh_dong",
];
const forbidden = [
  /người yêu cũ|tình cũ/i,
  /gia đình|cha mẹ|bố mẹ/i,
  /tiền bạc|tài chính|thu nhập/i,
  /hôn nhân|kết hôn|con cái|sinh con/i,
  /thân mật|tình dục/i,
  /sang chấn|tổn thương trong quá khứ/i,
  /mâu thuẫn hiện tại|cãi nhau/i,
  /chẩn đoán|trầm cảm|rối loạn tâm lý/i,
  /chứng minh.*(?:yêu|tình cảm)|bí mật nguy hiểm/i,
  /ChatGPT|OpenAI|Claude|Gemini|Llama|Cloudflare|quảng cáo/i,
];

const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    cards: {
      type: "array",
      minItems: 40,
      maxItems: 40,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          group: { type: "string", enum: groups },
          form: { type: "string", enum: forms },
          question: { type: "string", minLength: 15, maxLength: 180 },
        },
        required: ["group", "form", "question"],
      },
    },
  },
  required: ["cards"],
};

const normalize = (value) => value
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/đ/g, "d")
  .replace(/[^a-z0-9\s]/g, "")
  .replace(/\s+/g, " ")
  .trim();

function validateDeck(deck) {
  const errors = [];
  const cards = deck?.cards;
  if (!Array.isArray(cards) || cards.length !== 40) {
    return { valid: false, errors: ["deck must contain exactly 40 cards"] };
  }

  for (const [index, card] of cards.entries()) {
    if (!groups.includes(card?.group)) errors.push(`card ${index + 1}: invalid group`);
    if (!forms.includes(card?.form)) errors.push(`card ${index + 1}: invalid form`);
    if (typeof card?.question !== "string" || card.question.length < 15 || card.question.length > 180) {
      errors.push(`card ${index + 1}: question length must be 15-180 characters`);
      continue;
    }
    if (!/[ăâđêôơưà-ỹ]/i.test(card.question)) errors.push(`card ${index + 1}: not clearly Vietnamese`);
    if (forbidden.some((pattern) => pattern.test(card.question))) errors.push(`card ${index + 1}: forbidden content`);
  }

  for (const group of groups) {
    if (cards.filter((card) => card.group === group).length !== 8) errors.push(`${group}: must contain 8 cards`);
  }

  const questions = cards.map((card) => normalize(card.question ?? ""));
  if (new Set(questions).size !== questions.length) errors.push("deck contains exact normalized duplicates");
  if (new Set(cards.map((card) => card.form)).size < 5) errors.push("deck uses fewer than 5 question forms");
  for (let index = 3; index < cards.length; index += 1) {
    if (cards.slice(index - 3, index + 1).every((card) => card.form === cards[index].form)) {
      errors.push(`card ${index + 1}: more than 3 consecutive cards share one form`);
    }
  }
  return { valid: errors.length === 0, errors };
}

function fixture() {
  return {
    cards: groups.flatMap((group, groupIndex) => Array.from({ length: 8 }, (_, index) => ({
      group,
      form: forms[(groupIndex * 8 + index) % forms.length],
      question: `Bạn muốn kể điều đáng nhớ số ${groupIndex + 1}-${index + 1} nào về hai đứa mình?`,
    }))),
  };
}

function selfTest() {
  assert.deepEqual(validateDeck(fixture()), { valid: true, errors: [] });
  const unsafe = fixture();
  unsafe.cards[0].question = "Bạn muốn nói gì về người yêu cũ của mình?";
  assert.equal(validateDeck(unsafe).valid, false);
  assert.equal(normalize("  Điều Đáng Nhớ? "), "dieu dang nho");
  console.log("workers ai spike self-test: ok");
}

function prompt(seed, previousQuestions) {
  return `Tạo đúng 40 lá Deep Talk bằng tiếng Việt tự nhiên cho một cặp đôi, mã ngẫu nhiên ${seed}.
Mỗi nhóm mo_long, ky_uc, thau_hieu, chan_that, tuong_lai có đúng 8 lá.
Dùng đa dạng các form trong enum; không quá 3 form giống nhau liên tiếp.
Câu hỏi ngắn, rõ, không đúng/sai, không phán xét, không trị liệu, không ép chứng minh tình yêu.
Không dùng chủ đề nhạy cảm: người yêu cũ, gia đình, tiền bạc, hôn nhân, con cái, thân mật, sang chấn, mâu thuẫn hiện tại.
Không nhắc dịch vụ AI, thương hiệu hoặc quảng cáo. Hai câu cuối phải tích cực.
Không lặp hoặc chỉ đổi vài từ từ các câu cần tránh sau: ${previousQuestions.length ? previousQuestions.join(" | ") : "không có"}.`;
}

async function generate(seed, previousQuestions) {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !token) throw new Error("Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN in the process environment");

  const started = performance.now();
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      messages: [
        { role: "system", content: "Chỉ trả về JSON đúng schema. Không thêm giải thích." },
        { role: "user", content: prompt(seed, previousQuestions) },
      ],
      response_format: { type: "json_schema", json_schema: schema },
      max_tokens: 4096,
      temperature: 0.8,
      seed,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const payload = await response.json();
  if (!response.ok || !payload.success) {
    throw new Error(`Workers AI returned ${response.status}: ${payload.errors?.[0]?.message ?? "unknown error"}`);
  }

  const raw = payload.result?.response;
  const deck = typeof raw === "string" ? JSON.parse(raw) : raw;
  return {
    deck,
    validation: validateDeck(deck),
    latencyMs: Math.round(performance.now() - started),
    usage: payload.result?.usage ?? null,
  };
}

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  const runs = [];
  const previousQuestions = [];
  for (const seed of [28082601, 28082602, 28082603]) {
    const run = await generate(seed, previousQuestions);
    runs.push(run);
    previousQuestions.push(...run.deck.cards.map((card) => card.question));
  }

  const normalized = runs.flatMap((run) => run.deck.cards.map((card) => normalize(card.question)));
  console.log(JSON.stringify({
    model,
    summary: {
      decks: runs.length,
      validDecks: runs.filter((run) => run.validation.valid).length,
      jsonConsistent: runs.every((run) => run.deck?.cards?.length === 40),
      repeatedQuestionsAcrossDecks: normalized.length - new Set(normalized).size,
      latencyMs: runs.map((run) => run.latencyMs),
      usage: runs.map((run) => run.usage),
    },
    runs,
  }, null, 2));
}
