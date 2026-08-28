import assert from "node:assert/strict";

const defaultModel = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const groups = ["mo_long", "ky_uc", "thau_hieu", "chan_that", "tuong_lai"];
const cardsPerGroup = 4;
const deckSize = groups.length * cardsPerGroup;
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
  /anh ấy|cô ấy/i,
  /ChatGPT|OpenAI|Claude|Gemini|Llama|Cloudflare|quảng cáo/i,
];

const schema = {
  type: "object",
  additionalProperties: false,
  properties: Object.fromEntries(groups.map((group) => [group, {
      type: "array",
      minItems: cardsPerGroup,
      maxItems: cardsPerGroup,
      items: { type: "string", minLength: 15, maxLength: 180 },
    }])),
  required: groups,
};

const normalize = (value = "") => value
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/đ/g, "d")
  .replace(/[^a-z0-9\s]/g, "")
  .replace(/\s+/g, " ")
  .trim();

function parseDeck(raw) {
  const parsed = raw && typeof raw === "object"
    ? raw
    : JSON.parse(raw.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1] ?? raw);
  if (Array.isArray(parsed.cards)) return parsed;
  return {
    cards: groups.flatMap((group, groupIndex) => (parsed[group] ?? []).map((question, index) => ({
      group,
      form: forms[(groupIndex * cardsPerGroup + index) % forms.length],
      question,
    }))),
  };
}

function validateDeck(deck) {
  const errors = [];
  const cards = deck?.cards;
  if (!Array.isArray(cards) || cards.length !== deckSize) {
    return { valid: false, errors: [`deck must contain exactly ${deckSize} cards`] };
  }

  for (const [index, card] of cards.entries()) {
    if (!groups.includes(card?.group)) errors.push(`card ${index + 1}: invalid group`);
    if (!forms.includes(card?.form)) errors.push(`card ${index + 1}: invalid form`);
    if (typeof card?.question !== "string" || card.question.length < 15 || card.question.length > 180) {
      errors.push(`card ${index + 1}: question length must be 15-180 characters`);
      continue;
    }
    if (!/[ăâđêôơưà-ỹ]/i.test(card.question)) errors.push(`card ${index + 1}: not clearly Vietnamese`);
    if (!/[?？]\s*$/.test(card.question)) errors.push(`card ${index + 1}: must be a question`);
    if (forbidden.some((pattern) => pattern.test(card.question))) errors.push(`card ${index + 1}: forbidden content`);
  }

  for (const group of groups) {
    if (cards.filter((card) => card.group === group).length !== cardsPerGroup) {
      errors.push(`${group}: must contain ${cardsPerGroup} cards`);
    }
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
    cards: groups.flatMap((group, groupIndex) => Array.from({ length: cardsPerGroup }, (_, index) => ({
      group,
      form: forms[(groupIndex * cardsPerGroup + index) % forms.length],
      question: `Bạn muốn kể điều đáng nhớ số ${groupIndex + 1}-${index + 1} nào về hai đứa mình?`,
    }))),
  };
}

function selfTest() {
  const validFixture = fixture();
  assert.deepEqual(validateDeck(validFixture), { valid: true, errors: [] });
  const grouped = Object.fromEntries(groups.map((group) => [
    group,
    validFixture.cards.filter((card) => card.group === group).map((card) => card.question),
  ]));
  assert.deepEqual(validateDeck(parseDeck(grouped)), { valid: true, errors: [] });
  const unsafe = fixture();
  unsafe.cards[0].question = "Bạn muốn nói gì về người yêu cũ của mình?";
  assert.equal(validateDeck(unsafe).valid, false);
  assert.equal(normalize("  Điều Đáng Nhớ? "), "dieu dang nho");
  assert.deepEqual(parseDeck({ cards: [] }), { cards: [] });
  assert.deepEqual(parseDeck("```json\n{\"cards\":[]}\n```"), { cards: [] });
  console.log("deep talk llm spike self-test: ok");
}

function prompt(seed, previousQuestions) {
  return `Tạo đúng ${deckSize} lá Deep Talk bằng tiếng Việt tự nhiên cho một cặp đôi, mã ngẫu nhiên ${seed}.
JSON gốc chỉ có 5 key mo_long, ky_uc, thau_hieu, chan_that, tuong_lai; mỗi value là đúng ${cardsPerGroup} chuỗi câu hỏi.
Trong mỗi nhóm, lần lượt dùng bốn góc hỏi khác nhau: kể chuyện; lựa chọn hoặc tưởng tượng; cảm giác hoặc nhìn nhận; mong muốn hoặc hành động.
Câu hỏi ngắn, rõ, không đúng/sai, không phán xét, không trị liệu, không ép chứng minh tình yêu.
Không dùng chủ đề nhạy cảm: người yêu cũ, gia đình, tiền bạc, hôn nhân, con cái, thân mật, sang chấn, mâu thuẫn hiện tại.
Không nhắc dịch vụ AI, thương hiệu hoặc quảng cáo. Hai câu cuối phải tích cực.
Không lặp hoặc chỉ đổi vài từ từ các câu cần tránh sau: ${previousQuestions.length ? previousQuestions.join(" | ") : "không có"}.`;
}

async function generate(seed, previousQuestions) {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  const model = process.env.CLOUDFLARE_AI_MODEL ?? defaultModel;
  if (!accountId || !apiToken) throw new Error("Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN");

  const started = performance.now();
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      messages: [
        { role: "system", content: "Chỉ trả về JSON đúng schema. Không thêm giải thích." },
        { role: "user", content: prompt(seed, previousQuestions) },
      ],
      response_format: { type: "json_schema", json_schema: schema },
      max_tokens: 8192,
      seed,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`Workers AI returned ${response.status}: ${payload.errors?.[0]?.message ?? "unknown error"}`);
  }

  const raw = payload.result?.response;
  if (!raw) throw new Error(`Workers AI returned no response: ${JSON.stringify(payload.errors ?? [])}`);
  const deck = parseDeck(raw);
  const validation = validateDeck(deck);
  if (!Array.isArray(deck?.cards)) {
    throw new Error(`Workers AI ignored the deck schema: ${JSON.stringify({
      keys: deck && typeof deck === "object" ? Object.keys(deck) : [],
      preview: typeof raw === "string" ? raw.slice(0, 300) : raw,
    })}`);
  }
  return {
    deck,
    validation,
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
    try {
      const run = await generate(seed, previousQuestions);
      runs.push(run);
      previousQuestions.push(...run.deck.cards.map((card) => card.question).filter((question) => typeof question === "string"));
    } catch (error) {
      runs.push({ error: error.message });
    }
  }

  const normalized = runs.flatMap((run) => (run.deck?.cards ?? []).map((card) => normalize(card.question)));
  const report = JSON.stringify({
    model: process.env.CLOUDFLARE_AI_MODEL ?? defaultModel,
    summary: {
      decks: runs.length,
      validDecks: runs.filter((run) => run.validation?.valid).length,
      jsonConsistent: runs.every((run) => run.deck?.cards?.length === deckSize),
      repeatedQuestionsAcrossDecks: normalized.length - new Set(normalized).size,
      latencyMs: runs.map((run) => run.latencyMs ?? null),
      usage: runs.map((run) => run.usage ?? null),
    },
    runs: runs.map((run) => run.error ? run : {
      validation: run.validation,
      latencyMs: run.latencyMs,
      usage: run.usage,
      sampleQuestions: run.deck.cards.slice(0, 5).map((card) => card.question),
    }),
  }, null, 2);
  console.log(report);
}
