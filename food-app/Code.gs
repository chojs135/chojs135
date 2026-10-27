/**
 * 찰칵 영양 분석 - 서버(Apps Script)
 *
 * 음식 사진을 Gemini API 로 보내 음식 이름·양·칼로리·영양소를 받아 온다.
 * API 키는 [프로젝트 설정 > 스크립트 속성] 의 GEMINI_API_KEY 에 넣는다. (화면에는 드러나지 않음)
 * 선택: GEMINI_MODEL (기본 gemini-flash-latest), DAILY_LIMIT (하루 분석 횟수 한도, 기본 300)
 */

const DEFAULT_MODEL = 'gemini-flash-latest';

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('찰칵 영양 분석')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

/** 처음 한 번 실행해서 키가 잘 들어갔는지 확인한다. */
function setup() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('GEMINI_API_KEY')) {
    Logger.log('스크립트 속성에 GEMINI_API_KEY 를 넣어 주세요. (aistudio.google.com 에서 무료로 발급)');
    return;
  }
  Logger.log('GEMINI_API_KEY 확인됨. 모델: ' + (props.getProperty('GEMINI_MODEL') || DEFAULT_MODEL));
}

/**
 * 음식 사진 분석.
 * @param {string} base64 JPEG/PNG 이미지 (data: 앞부분 없이)
 * @param {string} mimeType 'image/jpeg' 등
 * @param {object} ctx { meal: '아침'|'점심'|'저녁'|'간식', age, sex, targetKcal }  조언 문장에만 쓴다
 */
function analyzeFood(base64, mimeType, ctx) {
  const props = PropertiesService.getScriptProperties();
  const key = props.getProperty('GEMINI_API_KEY');
  if (!key) throw new Error('관리자가 아직 Gemini API 키를 설정하지 않았습니다.');
  if (!base64 || base64.length > 8 * 1024 * 1024) throw new Error('사진이 너무 큽니다. 다시 찍어 주세요.');
  if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(String(mimeType))) throw new Error('사진 파일만 올릴 수 있습니다.');
  countUse_(Number(props.getProperty('DAILY_LIMIT') || 300));

  ctx = ctx || {};
  const prompt = [
    '이 사진 속 음식을 분석해 줘. 한국 음식은 한국식 이름으로 써.',
    '- 사진에 보이는 음식을 하나씩 나누고, 보이는 양(1인분 기준 g 또는 개수)을 추정해.',
    '- 각 음식의 열량(kcal), 탄수화물·단백질·지방·당류·식이섬유(g), 나트륨(mg)을 그 양 기준으로 추정해.',
    '- 숫자는 한국 식품 영양성분 데이터베이스 수준의 일반적인 값으로.',
    '- 음식이 아니면 isFood 를 false 로 하고 foods 는 빈 배열.',
    '- advice: 이 식사를 ' + (ctx.meal || '한 끼') + '로 먹은 ' + (ctx.age || '') + '세 ' + (ctx.sex === 'F' ? '여성' : ctx.sex === 'M' ? '남성' : '') +
      '(한 끼 권장 약 ' + (ctx.targetKcal || '?') + 'kcal)에게 균형을 위해 더하거나 줄이면 좋을 음식을 2문장 이내 존댓말로.',
  ].join('\n');

  const body = {
    contents: [{ parts: [{ inline_data: { mime_type: mimeType, data: base64 } }, { text: prompt }] }],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          isFood: { type: 'BOOLEAN' },
          foods: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                name: { type: 'STRING' }, amount: { type: 'STRING' },
                kcal: { type: 'NUMBER' }, carb: { type: 'NUMBER' }, protein: { type: 'NUMBER' }, fat: { type: 'NUMBER' },
                sugar: { type: 'NUMBER' }, fiber: { type: 'NUMBER' }, sodium: { type: 'NUMBER' },
              },
              required: ['name', 'amount', 'kcal', 'carb', 'protein', 'fat', 'sugar', 'fiber', 'sodium'],
            },
          },
          advice: { type: 'STRING' },
        },
        required: ['isFood', 'foods', 'advice'],
      },
    },
  };

  const model = props.getProperty('GEMINI_MODEL') || DEFAULT_MODEL;
  const res = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-goog-api-key': key },
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code === 429) throw new Error('지금 사용하는 사람이 많아요. 1분 뒤에 다시 해 주세요.');
  if (code !== 200) {
    console.error(res.getContentText());
    throw new Error('분석 서버 오류(' + code + '). 잠시 뒤 다시 해 주세요.');
  }
  const data = JSON.parse(res.getContentText());
  const text = (((data.candidates || [])[0] || {}).content || {}).parts;
  if (!text || !text[0] || !text[0].text) throw new Error('사진을 분석하지 못했습니다. 음식이 잘 보이게 다시 찍어 주세요.');
  const out = JSON.parse(text[0].text);
  const num = v => Math.max(0, Math.round(Number(v) * 10) / 10 || 0);
  return {
    isFood: !!out.isFood,
    advice: String(out.advice || '').slice(0, 300),
    foods: (out.foods || []).slice(0, 12).map(f => ({
      name: String(f.name || '음식').slice(0, 30), amount: String(f.amount || '').slice(0, 30),
      kcal: num(f.kcal), carb: num(f.carb), protein: num(f.protein), fat: num(f.fat),
      sugar: num(f.sugar), fiber: num(f.fiber), sodium: num(f.sodium),
    })),
  };
}

/** 하루 분석 횟수 한도 (API 무료 사용량을 다른 사람이 다 써 버리지 않게). */
function countUse_(limit) {
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const props = PropertiesService.getScriptProperties();
    const today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
    const used = props.getProperty('USE_DATE') === today ? Number(props.getProperty('USE_COUNT') || 0) : 0;
    if (used >= limit) throw new Error('오늘 분석 횟수를 모두 썼습니다. 내일 다시 이용해 주세요.');
    props.setProperties({ USE_DATE: today, USE_COUNT: String(used + 1) });
  } finally {
    lock.releaseLock();
  }
}
