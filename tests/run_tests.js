const fs = require('fs');
const path = require('path');
const { loadWf, getCode, run } = require('./lib/harness');

const results = [];
function check(name, expected, actual, notes = '') {
  const pass = JSON.stringify(expected) === JSON.stringify(actual);
  results.push({ name, expected, actual, status: pass ? 'PASS' : 'FAIL', notes });
  return pass;
}
function checkTrue(name, cond, notes = '') {
  results.push({ name, expected: true, actual: cond, status: cond ? 'PASS' : 'FAIL', notes });
  return cond;
}

const wf1 = loadWf('01-wordpress-event-ingest.json');
const wf2 = loadWf('02-queue-publisher.json');
const wf3 = loadWf('03-error-handler.json');
const wf4 = loadWf('04-publication-dashboard.json');

// =========================================================================
// FIX #1 / T01-T04 — WordPress fullResponse + status normalization
// =========================================================================
{
  const fetchNode = wf1.nodes.find(n => n.name === 'واکشی Post کامل از WordPress API');
  checkTrue('STATIC: fullResponse=true on WP fetch node', fetchNode.parameters.options.response.response.fullResponse === true);

  const normCode = getCode(wf1, 'یکنواخت‌سازی پاسخ WordPress');
  const ifNode = wf1.nodes.find(n => n.name === 'واکشی موفق بود؟');
  const leftExpr = ifNode.parameters.conditions.conditions[0].leftValue;
  checkTrue('STATIC: IF node no longer falls back to 200', leftExpr.includes('599') && !leftExpr.includes('|| 200'));

  function normalizeThenCheck(rawItem) {
    const out = run(normCode, { inputItems: [{ json: rawItem }] });
    const statusCode = out[0].json.statusCode;
    return statusCode < 300; // mirrors the IF node's "< 300" success condition (599 fallback replaces 200)
  }

  check('T01 WordPress 200 -> success', true, normalizeThenCheck({ statusCode: 200, body: { id: 555 } }));
  check('T01b WordPress 201 -> success', true, normalizeThenCheck({ statusCode: 201, body: { id: 555 } }));
  check('T01c WordPress 204 -> success', true, normalizeThenCheck({ statusCode: 204, body: {} }));
  check('T02 WordPress 404 -> failure', false, normalizeThenCheck({ statusCode: 404, body: { code: 'rest_post_invalid_id' } }));
  check('T03 WordPress 401 -> failure', false, normalizeThenCheck({ statusCode: 401, body: { code: 'rest_forbidden' } }));
  check('T04 WordPress 500 -> failure', false, normalizeThenCheck({ statusCode: 500, body: {} }));
  check('T04b Missing statusCode entirely -> failure (not silently 200)', false, normalizeThenCheck({ body: { id: 555 } }));
}

// =========================================================================
// FIX #15 / T29-T30 — 401 vs 422 outcome split
// =========================================================================
{
  const code = getCode(wf1, 'اعتبارسنجی Webhook');
  const secret = 'S3CR3T_TEST_VALUE_1234567890';

  const missingSecret = run(code, { inputItems: [{ json: { headers: {}, body: { eventType: 'post.published', postId: 1 } } }], vars: { WORDPRESS_WEBHOOK_SECRET: secret } });
  check('T30 missing secret -> outcome=unauthorized', 'unauthorized', missingSecret[0].json.outcome);

  const wrongSecret = run(code, { inputItems: [{ json: { headers: { 'x-wp-webhook-secret': 'WRONG' }, body: { eventType: 'post.published', postId: 1 } } }], vars: { WORDPRESS_WEBHOOK_SECRET: secret } });
  check('T30b wrong secret -> outcome=unauthorized', 'unauthorized', wrongSecret[0].json.outcome);

  const invalidPayload = run(code, { inputItems: [{ json: { headers: { 'x-wp-webhook-secret': secret }, body: { eventType: 'post.deleted', postId: 1 } } }], vars: { WORDPRESS_WEBHOOK_SECRET: secret } });
  check('T29 valid auth + invalid eventType -> outcome=invalid_payload', 'invalid_payload', invalidPayload[0].json.outcome);

  const missingPostId = run(code, { inputItems: [{ json: { headers: { 'x-wp-webhook-secret': secret }, body: { eventType: 'post.published' } } }], vars: { WORDPRESS_WEBHOOK_SECRET: secret } });
  check('T29b valid auth + missing postId -> outcome=invalid_payload', 'invalid_payload', missingPostId[0].json.outcome);

  const ok = run(code, { inputItems: [{ json: { headers: { 'x-wp-webhook-secret': secret }, body: { eventType: 'post.published', postId: 101 } } }], vars: { WORDPRESS_WEBHOOK_SECRET: secret } });
  check('T ok path -> outcome=ok', 'ok', ok[0].json.outcome);

  const respNode422 = wf1.nodes.find(n => n.name === 'پاسخ 422 Payload نامعتبر');
  const respNode401 = wf1.nodes.find(n => n.name === 'پاسخ 401 غیرمجاز');
  checkTrue('STATIC: dedicated 422 response node exists with code 422', respNode422 && respNode422.parameters.options.responseCode === 422);
  checkTrue('STATIC: dedicated 401 response node exists with code 401', respNode401 && respNode401.parameters.options.responseCode === 401);
}

// =========================================================================
// FIX #6 / #7 / T13-T16 — timing-safe compare + legacy header removed
// =========================================================================
{
  const code = getCode(wf1, 'اعتبارسنجی Webhook');
  checkTrue('STATIC: legacy x-omid90-webhook-secret header no longer read (only mentioned in a removal comment, if at all)', !code.includes("headers['x-omid90-webhook-secret']"));
  checkTrue('STATIC: uses crypto.timingSafeEqual', code.includes('timingSafeEqual'));

  const secret = 'ABCDEFGHIJ0123456789';
  const T13 = run(code, { inputItems: [{ json: { headers: { 'x-wp-webhook-secret': secret }, body: { eventType: 'post.published', postId: 1 } } }], vars: { WORDPRESS_WEBHOOK_SECRET: secret } });
  check('T13 correct secret -> authorized=true', true, T13[0].json.authorized);

  const T14 = run(code, { inputItems: [{ json: { headers: { 'x-wp-webhook-secret': 'WRONGWRONGWRONGWRONG' }, body: { eventType: 'post.published', postId: 1 } } }], vars: { WORDPRESS_WEBHOOK_SECRET: secret } });
  check('T14 wrong secret (same length) -> authorized=false', false, T14[0].json.authorized);

  const T15 = run(code, { inputItems: [{ json: { headers: { 'x-wp-webhook-secret': '' }, body: { eventType: 'post.published', postId: 1 } } }], vars: { WORDPRESS_WEBHOOK_SECRET: secret } });
  check('T15 empty secret header -> authorized=false', false, T15[0].json.authorized);

  const T15b = run(code, { inputItems: [{ json: { headers: {}, body: { eventType: 'post.published', postId: 1 } } }], vars: { WORDPRESS_WEBHOOK_SECRET: '' } });
  check('T15c missing expected secret (empty var) -> authorized=false', false, T15b[0].json.authorized);

  const shortSecret = run(code, { inputItems: [{ json: { headers: { 'x-wp-webhook-secret': 'short' }, body: { eventType: 'post.published', postId: 1 } } }], vars: { WORDPRESS_WEBHOOK_SECRET: secret } });
  check('T different-length secret -> authorized=false (no throw)', false, shortSecret[0].json.authorized);

  const nonString = run(code, { inputItems: [{ json: { headers: { 'x-wp-webhook-secret': 12345 }, body: { eventType: 'post.published', postId: 1 } } }], vars: { WORDPRESS_WEBHOOK_SECRET: secret } });
  check('T non-string header value -> authorized=false (no throw)', false, nonString[0].json.authorized);

  const T16 = run(code, { inputItems: [{ json: { headers: { 'x-omid90-webhook-secret': secret }, body: { eventType: 'post.published', postId: 1 } } }], vars: { WORDPRESS_WEBHOOK_SECRET: secret } });
  check('T16 legacy header alone -> authorized=false (removed)', false, T16[0].json.authorized);
}

// =========================================================================
// Normalize Article (regression, unchanged logic) + duplicate detection
// =========================================================================
const wpPost = {
  id: 555,
  title: { rendered: 'عنوان &#8220;تست&#8221; مقاله' },
  content: { rendered: '<p>این یک <strong>متن</strong> تست است.</p>' },
  excerpt: { rendered: '<p>خلاصه تست</p>' },
  link: 'https://example.com/post/555',
  date_gmt: '2026-08-01T10:00:00',
  modified_gmt: '2026-08-01T10:00:00',
  _embedded: {
    author: [{ name: 'نویسنده تست' }],
    'wp:term': [[{ name: 'دسته یک' }], [{ name: 'برچسب یک' }]],
    'wp:featuredmedia': [{ source_url: 'https://example.com/img.jpg' }]
  }
};
let normalizedItems;
{
  const code = getCode(wf1, 'Normalize Article');
  const nodeRegistry = { 'اعتبارسنجی Webhook': [{ json: { eventType: 'post.published', postId: 555, receivedAt: '2026-08-08T00:00:00Z' } }] };
  normalizedItems = run(code, { inputItems: [{ json: { body: wpPost } }], nodeRegistry });
  check('T31 Persian content normalized correctly', 'عنوان "تست" مقاله', normalizedItems[0].json.article.title);
  checkTrue('T31b Persian content preserved (no mangled chars)', normalizedItems[0].json.article.contentText.includes('متن'));
}

// T19/T20 duplicate detection sequential + simulated concurrent
{
  const code = getCode(wf1, 'تشخیص تکراری');
  const nodeRegistry = { 'Normalize Article': normalizedItems };

  const seq1 = run(code, { inputItems: [], nodeRegistry }); // no existing rows -> not duplicate
  check('T19a Sequential: first request -> duplicate=false', false, seq1[0].json.duplicate);

  const seq2 = run(code, { inputItems: [{ json: { event_id: normalizedItems[0].json.eventId } }], nodeRegistry });
  check('T19b Sequential: second request (row now exists) -> duplicate=true', true, seq2[0].json.duplicate);

  // T20: simulate concurrent race — both workers read BEFORE either inserts (classic TOCTOU)
  const concurrentA = run(code, { inputItems: [], nodeRegistry }); // worker A reads empty table
  const concurrentB = run(code, { inputItems: [], nodeRegistry }); // worker B reads empty table too (race window)
  checkTrue('T20 Concurrent race window: both workers see duplicate=false at read time (expected TOCTOU)', concurrentA[0].json.duplicate === false && concurrentB[0].json.duplicate === false,
    'This demonstrates WHY Fix #10 (race detection on insert) is necessary — the code-node read step alone cannot prevent the race.');

  // Fix #10 mitigation: race-detection node catches the loser of the insert race
  const raceCode = getCode(wf1, 'بررسی نتیجه ثبت Event (Race Detection)');
  const raceRegistry = { 'تشخیص تکراری': [{ json: { ...normalizedItems[0].json, duplicate: false } }] };
  const loserInsertResult = run(raceCode, { inputItems: [{ json: { error: true, message: 'duplicate key value violates unique constraint "omid90_events_event_id_key"' } }], nodeRegistry: raceRegistry });
  check('T20b Fix#10: insert failure due to UNIQUE violation -> insertRaceDetected=true (treated as duplicate)', true, loserInsertResult[0].json.insertRaceDetected);

  const winnerInsertResult = run(raceCode, { inputItems: [{ json: { event_id: normalizedItems[0].json.eventId, status: 'accepted' } }], nodeRegistry: raceRegistry });
  check('T20c Fix#10: successful insert -> insertRaceDetected=false', false, winnerInsertResult[0].json.insertRaceDetected);
}

// =========================================================================
// FIX #3 / T07-T08 — job aggregation before Respond to Webhook
// =========================================================================
{
  const buildCode = getCode(wf1, 'ساخت Publication Job برای هر پلتفرم');
  const nodeRegistry1 = { 'تشخیص تکراری': [{ json: { ...normalizedItems[0].json, duplicate: false } }] };
  const jobs1 = run(buildCode, { inputItems: [{ json: {} }], vars: { ACTIVE_PLATFORMS: 'telegram' }, nodeRegistry: nodeRegistry1 });
  const jobs2 = run(buildCode, { inputItems: [{ json: {} }], vars: { ACTIVE_PLATFORMS: 'telegram,x' }, nodeRegistry: nodeRegistry1 });
  const jobs6 = run(buildCode, { inputItems: [{ json: {} }], vars: { ACTIVE_PLATFORMS: 'telegram,bale,eitaa,rubika,x,linkedin' }, nodeRegistry: nodeRegistry1 });

  const aggCode = getCode(wf1, 'تجمیع نتیجه Jobها');
  const aggRegistry = { 'تشخیص تکراری': [{ json: { ...normalizedItems[0].json, duplicate: false } }] };

  const agg1 = run(aggCode, { inputItems: jobs1, nodeRegistry: aggRegistry });
  check('T07 Respond aggregation: 1 platform -> jobsCreated=1, single item out', 1, agg1[0].json.jobsCreated);
  checkTrue('T07b aggregation always returns exactly 1 item', agg1.length === 1);

  const agg2 = run(aggCode, { inputItems: jobs2, nodeRegistry: aggRegistry });
  check('T08a Respond aggregation: 2 platforms -> jobsCreated=2', 2, agg2[0].json.jobsCreated);

  const agg6 = run(aggCode, { inputItems: jobs6, nodeRegistry: aggRegistry });
  check('T08b Respond aggregation: 6 platforms -> jobsCreated=6', 6, agg6[0].json.jobsCreated);
  checkTrue('T08c aggregation always returns exactly 1 item even with 6 jobs', agg6.length === 1);

  checkTrue('T34 Multi-channel: all 6 job_ids unique', new Set(jobs6.map(j => j.json.job_id)).size === 6);
}

// =========================================================================
// FIX #2 / #5 / #14 / T05-T06 / T12 / T27-T28 — normalize send result
// =========================================================================
{
  const normCode = getCode(wf2, 'نرمال‌سازی نتیجه ارسال');
  const ctxRegistry = { 'آماده‌سازی Context انتشار': [{ json: { platform: 'telegram', job_id: '555:telegram:v1', attempts: 1, max_attempts: 5 } }] };

  const successOut = run(normCode, { inputItems: [{ json: { statusCode: 200, body: { ok: true, result: { message_id: 1 } } } }], nodeRegistry: ctxRegistry });
  check('T06 Known platform (telegram) success -> ok=true', true, successOut[0].json.delivery.ok);

  const unknownDelivery = { ok: false, statusCode: 0, permanent: true, response: { error: 'Unknown/unsupported platform: mastodon' }, finishedAt: new Date().toISOString() };
  const unknownOut = run(normCode, { inputItems: [{ json: { platform: 'mastodon', delivery: unknownDelivery } }], nodeRegistry: ctxRegistry });
  check('T05 Unknown platform -> delivery.ok stays false (regression guard for old bug)', false, unknownOut[0].json.delivery.ok);
  check('T05b Unknown platform -> permanent=true preserved', true, unknownOut[0].json.delivery.permanent);

  const perm401 = run(normCode, { inputItems: [{ json: { statusCode: 401, body: { ok: false, error: 'unauthorized' } } }], nodeRegistry: ctxRegistry });
  check('T27 401 -> ok=false, permanent=true, classification=permanent', { ok: false, permanent: true, classification: 'permanent' },
    { ok: perm401[0].json.delivery.ok, permanent: perm401[0].json.delivery.permanent, classification: perm401[0].json.delivery.classification });

  const temp429 = run(normCode, { inputItems: [{ json: { statusCode: 429, body: { ok: false, error: 'rate limited' } } }], nodeRegistry: ctxRegistry });
  check('T28 429 -> ok=false, permanent=false, classification=temporary', { ok: false, permanent: false, classification: 'temporary' },
    { ok: temp429[0].json.delivery.ok, permanent: temp429[0].json.delivery.permanent, classification: temp429[0].json.delivery.classification });

  const temp500 = run(normCode, { inputItems: [{ json: { statusCode: 500, body: {} } }], nodeRegistry: ctxRegistry });
  check('T28b 500 -> classification=temporary', 'temporary', temp500[0].json.delivery.classification);

  const unmapped418 = run(normCode, { inputItems: [{ json: { statusCode: 418, body: { ok: false } } }], nodeRegistry: ctxRegistry });
  check('Fix#14 Unmapped code 418 -> classification=unknown, permanent=false (safe retry default)', { permanent: false, classification: 'unknown' },
    { permanent: unmapped418[0].json.delivery.permanent, classification: unmapped418[0].json.delivery.classification });

  checkTrue('STATIC: temporaryCodes variable actually used in logic (Fix #14)', getCode(wf2, 'نرمال‌سازی نتیجه ارسال').includes('temporaryCodes.has(statusCode)'));

  const dirtyResp = {
    statusCode: 500,
    body: {
      Token: 'SECRET_TOKEN_VALUE',
      data: { Authorization: 'Bearer SECRET', nested: { cookie: 'sid=abc123' } },
      list: [{ secret: 'nested-in-array' }, 'plain-string'],
      safeField: 'keep-me'
    }
  };
  const redactedOut = run(normCode, { inputItems: [{ json: dirtyResp }], nodeRegistry: ctxRegistry });
  const savedResp = redactedOut[0].json.delivery.response;
  checkTrue('T12a Redaction: top-level Token key redacted (case-insensitive)', savedResp.Token === '[REDACTED]');
  checkTrue('T12b Redaction: nested Authorization key redacted', savedResp.data.Authorization === '[REDACTED]');
  checkTrue('T12c Redaction: deeply nested cookie key redacted', savedResp.data.nested.cookie === '[REDACTED]');
  checkTrue('T12d Redaction: secret inside array element redacted', savedResp.list[0].secret === '[REDACTED]');
  checkTrue('T12e Redaction: safe field preserved untouched', savedResp.safeField === 'keep-me');
  checkTrue('T12f Redaction: does not corrupt statusCode used for ok/permanent computation', redactedOut[0].json.delivery.statusCode === 500);
}

// =========================================================================
// FIX #10 (lock side) — optimistic lock verification node
// =========================================================================
{
  const lockCode = getCode(wf2, 'تایید Lock (Skip در صورت رقابت)');
  const won = run(lockCode, { inputItems: [{ json: { job_id: '1:telegram:v1', status: 'processing' } }] });
  check('Fix#10 Lock verify: worker won race (status=processing) -> locked=true', true, won[0].json.locked);

  const lost = run(lockCode, { inputItems: [] });
  check('Fix#10 Lock verify: worker lost race (0 rows updated) -> locked=false', false, lost[0].json.locked);
  checkTrue('Fix#10 Lock verify never throws / always returns exactly one item', lost.length === 1);
}

// =========================================================================
// FIX #9 / T17-T18 — Telegram official node (static verification)
// =========================================================================
{
  const tgNode = wf2.nodes.find(n => n.name === 'Telegram Publisher');
  checkTrue('T17 STATIC: Telegram Publisher uses official n8n-nodes-base.telegram node', tgNode.type === 'n8n-nodes-base.telegram');
  const paramsOnlyStr = JSON.stringify(wf2.nodes.map(n => n.parameters));
  checkTrue('T17b STATIC: no direct $credentials.* access in any node parameters/expressions (mentions in notes are fine)', paramsOnlyStr.indexOf('$credentials') === -1);
  checkTrue('T18 STATIC: Telegram node references a credential (not inline token)', !!(tgNode.credentials && tgNode.credentials.telegramApi));
}

// =========================================================================
// FIX #13 / T26 — X_API_BASE actually used
// =========================================================================
{
  const xFmtCode = getCode(wf2, 'X Formatter');
  const xPubNode = wf2.nodes.find(n => n.name === 'X Publisher');
  checkTrue('T26 STATIC: X Publisher URL derived from $vars.X_API_BASE', xPubNode.parameters.url.includes('$vars.X_API_BASE'));
  // A fallback default (`$vars.X_API_BASE || 'https://api.x.com'`) is fine and expected;
  // what must NOT happen is the URL being built without ever referencing the variable at all.
  const urlChangesWithVar = xPubNode.parameters.url.match(/\$vars\.X_API_BASE/);
  checkTrue('T26b STATIC: X Publisher URL genuinely reads the variable (not just a comment)', !!urlChangesWithVar);

  const longTitle = 'عنوان بسیار بسیار بسیار بسیار طولانی مقاله که قرار است در توییتر منتشر شود و باید کوتاه شود چون بیش از حد مجاز طول دارد و ادامه دارد و ادامه دارد و ادامه دارد و ادامه دارد و ادامه دارد و ادامه دارد و ادامه دارد و ادامه دارد';
  const out = run(xFmtCode, { inputItems: [{ json: { article: { title: longTitle, url: 'https://example.com/post/555', excerpt: 'x' } } }] });
  checkTrue('T32 X tweet stays <= 280 chars with long Persian title', out[0].json.formatted.text.length <= 280);
}

// =========================================================================
// T32/T33 — Emoji + newline handling across formatters
// =========================================================================
{
  const tgFmt = getCode(wf2, 'Telegram Formatter');
  const out = run(tgFmt, { inputItems: [{ json: { article: { title: '🎉 خبر مهم 🚀', excerpt: 'خط اول\nخط دوم', url: 'https://example.com/1' } } }] });
  checkTrue('T32b Telegram formatter preserves emoji', out[0].json.formatted.text.includes('🎉') && out[0].json.formatted.text.includes('🚀'));
  checkTrue('T33 Telegram formatter preserves newlines', out[0].json.formatted.text.includes('\n'));
}

// =========================================================================
// FIX #4 / T09-T11 — Dashboard authentication
// =========================================================================
{
  const authCode = getCode(wf4, 'اعتبارسنجی Dashboard Secret');
  const secret = 'DASHBOARD_SECRET_VALUE_XYZ';

  const T09 = run(authCode, { inputItems: [{ json: { headers: { 'x-dashboard-api-secret': secret } } }], vars: { DASHBOARD_API_SECRET: secret } });
  check('T09 dashboard correct secret -> authorized=true', true, T09[0].json.authorized);

  const T10 = run(authCode, { inputItems: [{ json: { headers: { 'x-dashboard-api-secret': 'WRONG_VALUE_HERE_XYZ' } } }], vars: { DASHBOARD_API_SECRET: secret } });
  check('T10 dashboard wrong secret -> authorized=false', false, T10[0].json.authorized);

  const T11 = run(authCode, { inputItems: [{ json: { headers: {} } }], vars: { DASHBOARD_API_SECRET: secret } });
  check('T11 dashboard missing secret -> authorized=false', false, T11[0].json.authorized);

  checkTrue('STATIC: auth node connected first from webhook trigger', wf4.connections['Dashboard API'].main[0][0].node === 'اعتبارسنجی Dashboard Secret');
  checkTrue('STATIC: 401 response node exists on dashboard', !!wf4.nodes.find(n => n.name === 'پاسخ 401'));
}

// =========================================================================
// FIX #11 / T21-T24 — Data Table filters / limits (static verification;
// actual filter semantics can only be confirmed against a live n8n Data Table)
// =========================================================================
{
  const lookupNode = wf1.nodes.find(n => n.name === 'جستجوی eventId در Data Store');
  checkTrue('T21 STATIC: event lookup has event_id filter + limit', !!lookupNode.parameters.filters && lookupNode.parameters.limit === 1);

  const pendingNode = wf2.nodes.find(n => n.name === 'خواندن Jobهای Pending');
  checkTrue('T22 STATIC: pending queue read has status=pending filter', pendingNode.parameters.filters.conditions.some(c => c.keyName === 'status' && c.keyValue === 'pending'));

  const sortCode = getCode(wf2, 'مرتب‌سازی و محدودسازی صف');
  checkTrue('T22b STATIC: code-level next_attempt_at<=now filter present (Data Table cannot filter against dynamic "now")', sortCode.includes('next_attempt_at') && sortCode.includes('now'));
  checkTrue('T23 STATIC: queue limited to 50 in code', sortCode.includes('.slice(0,50)'));
  checkTrue('STATIC: ordering by priority ASC, created_at ASC', sortCode.includes('priority') && sortCode.includes('created_at'));

  const dashEvents = wf4.nodes.find(n => n.name === 'خواندن Events');
  const dashQueue = wf4.nodes.find(n => n.name === 'خواندن Queue');
  const dashErrors = wf4.nodes.find(n => n.name === 'خواندن Errors');
  for (const [label, n] of [['events', dashEvents], ['queue', dashQueue], ['errors', dashErrors]]) {
    checkTrue(`T24 STATIC: dashboard ${label} read has 30-day filter + limit`, !!n.parameters.filters && n.parameters.limit > 0 && JSON.stringify(n.parameters.filters).includes('days:30'));
  }
}

// =========================================================================
// FIX #12 / T25 — execution save configuration alignment
// =========================================================================
{
  const dc = fs.readFileSync(path.join(__dirname, '..', 'docker-compose.yml'), 'utf8');
  const dcSuccessNone = /EXECUTIONS_DATA_SAVE_ON_SUCCESS:\s*none/.test(dc);
  const dcErrorAll = /EXECUTIONS_DATA_SAVE_ON_ERROR:\s*all/.test(dc);
  checkTrue('T25a docker-compose: EXECUTIONS_DATA_SAVE_ON_SUCCESS=none', dcSuccessNone);
  checkTrue('T25b docker-compose: EXECUTIONS_DATA_SAVE_ON_ERROR=all', dcErrorAll);

  for (const [name, wf] of [['wf01', wf1], ['wf02', wf2], ['wf03', wf3], ['wf04', wf4]]) {
    checkTrue(`T25c ${name} settings.saveDataSuccessExecution=none (matches docker-compose)`, wf.settings.saveDataSuccessExecution === 'none');
    checkTrue(`T25d ${name} settings.saveDataErrorExecution=all`, wf.settings.saveDataErrorExecution === 'all');
  }
}

// =========================================================================
// FIX #8 — Docker image pinning (static)
// =========================================================================
{
  const dc = fs.readFileSync(path.join(__dirname, '..', 'docker-compose.yml'), 'utf8');
  const imageLine = (dc.match(/^\s*image:\s*n8nio\/n8n:\S+/m) || [''])[0];
  checkTrue('STATIC: n8n image line is not :latest', imageLine.length > 0 && !imageLine.endsWith(':latest'));
  checkTrue('STATIC: n8n image has an explicit version tag', /^\s*image:\s*n8nio\/n8n:[0-9]/.test(imageLine));
}

// =========================================================================
// Dashboard KPI regression (unchanged math, still correct)
// =========================================================================
{
  const code = getCode(wf4, 'محاسبه KPI انتشار');
  const now = new Date();
  const recent = (daysAgo) => new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
  const nodeRegistry = {
    'خواندن Events': [{ json: { event_id: 'e1', received_at: recent(1) } }, { json: { event_id: 'e2', received_at: recent(2) } }],
    'خواندن Queue': [
      { json: { job_id: '1', status: 'sent', platform: 'telegram', created_at: recent(1), started_at: recent(1), sent_at: recent(1) } },
      { json: { job_id: '2', status: 'failed', platform: 'x', created_at: recent(1), attempts: 5 } },
      { json: { job_id: '3', status: 'pending', platform: 'linkedin', created_at: recent(2), attempts: 1 } },
    ],
    'خواندن Errors': [{ json: { error_id: 'err1', status: 'open', occurred_at: recent(1) } }]
  };
  const out = run(code, { inputItems: [{ json: {} }], nodeRegistry });
  const s = out[0].json.summary;
  check('Dashboard KPI totals (regression, within 30-day window)', { totalArticles: 2, totalJobs: 3, sent: 1, failed: 1, pending: 1, openErrors: 1, successRate: 50 },
    { totalArticles: s.totalArticles, totalJobs: s.totalJobs, sent: s.sent, failed: s.failed, pending: s.pending, openErrors: s.openErrors, successRate: s.successRate });

  // T24b: records OLDER than 30 days must be excluded by the code-side guarantee (Fix #11)
  const oldRegistry = {
    'خواندن Events': [{ json: { event_id: 'old1', received_at: recent(45) } }],
    'خواندن Queue': [{ json: { job_id: 'old-job', status: 'sent', platform: 'telegram', created_at: recent(45) } }],
    'خواندن Errors': [{ json: { error_id: 'old-err', status: 'open', occurred_at: recent(45) } }]
  };
  const oldOut = run(code, { inputItems: [{ json: {} }], nodeRegistry: oldRegistry });
  check('T24b Records older than 30 days excluded from KPI (code-side guarantee)', { totalArticles: 0, totalJobs: 0, openErrors: 0 },
    { totalArticles: oldOut[0].json.summary.totalArticles, totalJobs: oldOut[0].json.summary.totalJobs, openErrors: oldOut[0].json.summary.openErrors });
}

// =========================================================================
// T35 — Full pipeline simulation (code-node chain, single article, 2 platforms)
// =========================================================================
{
  const validateCode = getCode(wf1, 'اعتبارسنجی Webhook');
  const secret = 'E2E_SECRET_VALUE_9876543210';
  const validated = run(validateCode, { inputItems: [{ json: { headers: { 'x-wp-webhook-secret': secret }, body: { eventType: 'post.published', postId: 777 } } }], vars: { WORDPRESS_WEBHOOK_SECRET: secret } });
  checkTrue('T35a E2E: webhook validated', validated[0].json.valid === true);

  const wpFetchNorm = run(getCode(wf1, 'یکنواخت‌سازی پاسخ WordPress'), { inputItems: [{ json: { statusCode: 200, body: { ...wpPost, id: 777, link: 'https://example.com/post/777' } } }] });
  checkTrue('T35b E2E: WP fetch normalized to success', wpFetchNorm[0].json.statusCode < 300);

  const normalized = run(getCode(wf1, 'Normalize Article'), {
    inputItems: [{ json: wpFetchNorm[0].json }],
    nodeRegistry: { 'اعتبارسنجی Webhook': [{ json: { eventType: 'post.published', postId: 777, receivedAt: new Date().toISOString() } }] }
  });
  checkTrue('T35c E2E: article normalized with correct postId', normalized[0].json.article.postId === 777);

  const dup = run(getCode(wf1, 'تشخیص تکراری'), { inputItems: [], nodeRegistry: { 'Normalize Article': normalized } });
  checkTrue('T35d E2E: new article not duplicate', dup[0].json.duplicate === false);

  const jobs = run(getCode(wf1, 'ساخت Publication Job برای هر پلتفرم'), { inputItems: [{ json: {} }], vars: { ACTIVE_PLATFORMS: 'telegram,x' }, nodeRegistry: { 'تشخیص تکراری': dup } });
  checkTrue('T35e E2E: 2 jobs created for telegram,x', jobs.length === 2);

  const agg = run(getCode(wf1, 'تجمیع نتیجه Jobها'), { inputItems: jobs, nodeRegistry: { 'تشخیص تکراری': dup } });
  check('T35f E2E: aggregated response jobsCreated=2', 2, agg[0].json.jobsCreated);

  const tgJob = jobs[0].json;
  const tgFormatted = run(getCode(wf2, 'Telegram Formatter'), { inputItems: [{ json: { ...tgJob, article: normalized[0].json.article } }] });
  const tgResult = run(getCode(wf2, 'نرمال‌سازی نتیجه ارسال'), {
    inputItems: [{ json: { statusCode: 200, body: { ok: true } } }],
    nodeRegistry: { 'آماده‌سازی Context انتشار': [tgFormatted[0]] }
  });
  checkTrue('T35g E2E: telegram job delivered ok', tgResult[0].json.delivery.ok === true);

  const xJob = jobs[1].json;
  const xFormatted = run(getCode(wf2, 'X Formatter'), { inputItems: [{ json: { ...xJob, article: normalized[0].json.article } }] });
  const xResult = run(getCode(wf2, 'نرمال‌سازی نتیجه ارسال'), {
    inputItems: [{ json: { statusCode: 403, body: { ok: false, error: 'forbidden' } } }],
    nodeRegistry: { 'آماده‌سازی Context انتشار': [xFormatted[0]] }
  });
  checkTrue('T35h E2E: x job fails permanently (403)', xResult[0].json.delivery.ok === false && xResult[0].json.delivery.permanent === true);

  const retryCalc = run(getCode(wf2, 'طبقه‌بندی خطا و محاسبه Retry/Backoff'), {
    inputItems: [{ json: { ...xJob, delivery: xResult[0].json.delivery } }]
  });
  checkTrue('T35i E2E: x job marked finalFailed (permanent, no retry)', retryCalc[0].json.finalFailed === true);
  checkTrue('T35j E2E: telegram job unaffected by x job failure (independent rows)', tgResult[0].json.delivery.ok === true);
}

// ========== Print report ==========
const passCount = results.filter(r => r.status === 'PASS').length;
console.log(`\n${passCount}/${results.length} logic checks passed\n`);
for (const r of results) {
  console.log(`[${r.status}] ${r.name}` + (r.notes ? ` (${r.notes})` : ''));
  if (r.status === 'FAIL') {
    console.log('   expected:', JSON.stringify(r.expected));
    console.log('   actual  :', JSON.stringify(r.actual));
  }
}
fs.writeFileSync(path.join(__dirname, 'results.json'), JSON.stringify(results, null, 2));
if (passCount !== results.length) process.exitCode = 1;
