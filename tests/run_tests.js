const fs = require('fs');
const { loadWf, getCode, run } = require('./harness');

const results = [];
function check(name, expected, actual, notes='') {
  const pass = JSON.stringify(expected) === JSON.stringify(actual);
  results.push({name, expected, actual, status: pass ? 'PASS':'FAIL', notes});
  return pass;
}

// ========== Workflow 01 ==========
const wf1 = loadWf('01-wordpress-event-ingest.json');

// Test 1: valid webhook auth+event
{
  const code = getCode(wf1, 'اعتبارسنجی Webhook');
  const input = [{json:{headers:{'x-wp-webhook-secret':'S3CR3T'}, body:{eventType:'post.published', postId:101}}}];
  const out = run(code, {inputItems: input, vars:{WORDPRESS_WEBHOOK_SECRET:'S3CR3T'}});
  check('T1 Valid secret+event -> valid=true', true, out[0].json.valid);
}
// Test 3: invalid secret
{
  const code = getCode(wf1, 'اعتبارسنجی Webhook');
  const input = [{json:{headers:{'x-wp-webhook-secret':'WRONG'}, body:{eventType:'post.published', postId:101}}}];
  const out = run(code, {inputItems: input, vars:{WORDPRESS_WEBHOOK_SECRET:'S3CR3T'}});
  check('T3 Wrong secret -> valid=false', false, out[0].json.valid);
}
// Test 4: invalid event type
{
  const code = getCode(wf1, 'اعتبارسنجی Webhook');
  const input = [{json:{headers:{'x-wp-webhook-secret':'S3CR3T'}, body:{eventType:'post.deleted', postId:101}}}];
  const out = run(code, {inputItems: input, vars:{WORDPRESS_WEBHOOK_SECRET:'S3CR3T'}});
  check('T4 Unknown eventType -> valid=false', false, out[0].json.valid);
}

// Test: Normalize Article from a realistic WP REST payload
const wpPost = {
  id: 555,
  title: {rendered: 'عنوان &#8220;تست&#8221; مقاله'},
  content: {rendered: '<p>این یک <strong>متن</strong> تست است.</p>'},
  excerpt: {rendered: '<p>خلاصه تست</p>'},
  link: 'https://example.com/post/555',
  date_gmt: '2026-08-01T10:00:00',
  modified_gmt: '2026-08-01T10:00:00',
  _embedded: {
    author: [{name: 'نویسنده تست'}],
    'wp:term': [[{name:'دسته یک'}], [{name:'برچسب یک'}]],
    'wp:featuredmedia': [{source_url:'https://example.com/img.jpg'}]
  }
};
let normalizedItems;
{
  const code = getCode(wf1, 'Normalize Article');
  const input = [{json:{body: wpPost}}];
  const nodeRegistry = {'اعتبارسنجی Webhook':[{json:{eventType:'post.published', postId:555, receivedAt:'2026-08-08T00:00:00Z'}}]};
  const out = run(code, {inputItems: input, nodeRegistry});
  normalizedItems = out;
  check('T-Normalize article.title stripped', 'عنوان "تست" مقاله', out[0].json.article.title);
  check('T-Normalize eventId format', 'wp:555:2026-08-01T10:00:00Z', out[0].json.eventId);
  check('T-Normalize categories/tags', {c:['دسته یک'], t:['برچسب یک']}, {c:out[0].json.article.categories, t:out[0].json.article.tags});
}

// Test 2: Duplicate detection
{
  const code = getCode(wf1, 'تشخیص تکراری');
  const nodeRegistry = {'Normalize Article': normalizedItems};
  const rowsFound = [{json:{event_id:'wp:555:2026-08-01T10:00:00Z'}}];
  const out = run(code, {inputItems: rowsFound, vars:{}, nodeRegistry});
  check('T2 Duplicate event -> duplicate=true', true, out[0].json.duplicate);

  const rowsEmpty = [];
  const out2 = run(code, {inputItems: rowsEmpty, vars:{}, nodeRegistry});
  check('T2b New event, no rows -> duplicate=false', false, out2[0].json.duplicate);
}

// Test: Job creation for active platforms
{
  const code = getCode(wf1, 'ساخت Publication Job برای هر پلتفرم');
  const nodeRegistry = {'تشخیص تکراری': [{json:{...normalizedItems[0].json, duplicate:false}}]};
  const out = run(code, {inputItems: [{json:{}}], vars:{ACTIVE_PLATFORMS:'telegram,x,linkedin'}, nodeRegistry});
  check('T-Jobs count == active platforms', 3, out.length);
  check('T-Jobs job_id format', '555:telegram:2026-08-01T10:00:00Z', out[0].json.job_id);
}

// ========== Workflow 02 ==========
const wf2 = loadWf('02-queue-publisher.json');

// Test 6: X formatter respects 280 char limit
{
  const code = getCode(wf2, 'X Formatter');
  const longTitle = 'عنوان بسیار بسیار بسیار بسیار طولانی مقاله که قرار است در توییتر منتشر شود و باید کوتاه شود چون بیش از حد مجاز طول دارد و ادامه دارد و ادامه دارد و ادامه دارد و ادامه دارد و ادامه دارد و ادامه دارد و ادامه دارد و ادامه دارد';
  const input = [{json:{article:{title: longTitle, url:'https://example.com/post/555', excerpt:'x'}}}];
  const out = run(code, {inputItems: input});
  const len = out[0].json.formatted.text.length;
  check('T6 X tweet <= 280 chars', true, len <= 280, `actual length=${len}`);
}

// Test: Telegram formatter truncates at 4096
{
  const code = getCode(wf2, 'Telegram Formatter');
  const input = [{json:{article:{title:'t', excerpt:'e'.repeat(5000), url:'https://example.com'}}}];
  const out = run(code, {inputItems: input});
  check('T Telegram text <= 4096', true, out[0].json.formatted.text.length <= 4096);
}

// Test 6/7/8: Normalize response + retry classification
{
  const normCode = getCode(wf2, 'نرمال‌سازی نتیجه ارسال');
  const nodeRegistry = {'آماده‌سازی Context انتشار': [{json:{platform:'telegram', job_id:'555:telegram:v1', attempts:1, max_attempts:5}}]};
  const outSuccess = run(normCode, {inputItems:[{json:{statusCode:200, body:{ok:true}}}], nodeRegistry});
  check('T Delivery success ok=true', true, outSuccess[0].json.delivery.ok);

  const out429 = run(normCode, {inputItems:[{json:{statusCode:429, body:{ok:false, error:'rate limited'}}}], nodeRegistry});
  check('T7 429 -> ok=false, permanent=false', {ok:false, permanent:false}, {ok: out429[0].json.delivery.ok, permanent: out429[0].json.delivery.permanent});

  const out401 = run(normCode, {inputItems:[{json:{statusCode:401, body:{ok:false, error:'unauthorized'}}}], nodeRegistry});
  check('T8 401 -> ok=false, permanent=true', {ok:false, permanent:true}, {ok: out401[0].json.delivery.ok, permanent: out401[0].json.delivery.permanent});

  // Retry calc for temp failure, attempts below max
  const retryCode = getCode(wf2, 'طبقه‌بندی خطا و محاسبه Retry/Backoff');
  const jobTemp = {json:{platform:'telegram', job_id:'555:telegram:v1', attempts:2, max_attempts:5, delivery: out429[0].json.delivery}};
  const outRetry = run(retryCode, {inputItems:[jobTemp]});
  check('T7b Temp failure below max -> finalFailed=false, status=pending', {finalFailed:false, status:'pending'}, {finalFailed: outRetry[0].json.finalFailed, status: outRetry[0].json.status});

  // Test 9: Max retry reached
  const jobMax = {json:{platform:'telegram', job_id:'555:telegram:v1', attempts:5, max_attempts:5, delivery: out429[0].json.delivery}};
  const outMax = run(retryCode, {inputItems:[jobMax]});
  check('T9 Max attempts reached -> finalFailed=true, status=failed', {finalFailed:true, status:'failed'}, {finalFailed: outMax[0].json.finalFailed, status: outMax[0].json.status});

  // Test 8: Permanent failure -> finalFailed immediately even on attempt 1
  const jobPerm = {json:{platform:'telegram', job_id:'555:telegram:v1', attempts:1, max_attempts:5, delivery: out401[0].json.delivery}};
  const outPerm = run(retryCode, {inputItems:[jobPerm]});
  check('T8b Permanent 401 on attempt 1 -> finalFailed=true immediately', true, outPerm[0].json.finalFailed);
}

// Rate limit calc: platform-specific + var override
{
  const code = getCode(wf2, 'محاسبه تأخیر Rate Limit پلتفرم');
  const outDefault = run(code, {inputItems:[{json:{platform:'eitaa'}}], vars:{}});
  check('T RateLimit default eitaa=3s', 3, outDefault[0].json.rateLimitSeconds);
  const outOverride = run(code, {inputItems:[{json:{platform:'eitaa'}}], vars:{EITAA_RATE_LIMIT_SECONDS:'7'}});
  check('T RateLimit var override eitaa=7s', 7, outOverride[0].json.rateLimitSeconds);
}

// ========== Workflow 04 dashboard KPI ==========
const wf4 = loadWf('04-publication-dashboard.json');
{
  const code = getCode(wf4, 'محاسبه KPI انتشار');
  const nodeRegistry = {
    'خواندن Events': [{json:{event_id:'e1'}}, {json:{event_id:'e2'}}],
    'خواندن Queue': [
      {json:{job_id:'1', status:'sent', platform:'telegram', created_at:'2026-08-01', started_at:'2026-08-01T00:00:00Z', sent_at:'2026-08-01T00:00:02Z'}},
      {json:{job_id:'2', status:'failed', platform:'x', created_at:'2026-08-01', attempts:5}},
      {json:{job_id:'3', status:'pending', platform:'linkedin', created_at:'2026-08-02', attempts:1}},
    ],
    'خواندن Errors': [{json:{error_id:'err1', status:'open'}}]
  };
  const out = run(code, {inputItems:[{json:{}}], nodeRegistry});
  const s = out[0].json.summary;
  check('T11 Dashboard totals', {totalArticles:2, totalJobs:3, sent:1, failed:1, pending:1, openErrors:1, successRate:50},
    {totalArticles:s.totalArticles, totalJobs:s.totalJobs, sent:s.sent, failed:s.failed, pending:s.pending, openErrors:s.openErrors, successRate:s.successRate});
  // divide-by-zero guard
  const outEmpty = run(code, {inputItems:[{json:{}}], nodeRegistry:{'خواندن Events':[], 'خواندن Queue':[], 'خواندن Errors':[]}});
  check('T Dashboard empty data -> successRate=100, no crash', 100, outEmpty[0].json.summary.successRate);
}

// ========== Print report ==========
const passCount = results.filter(r=>r.status==='PASS').length;
console.log(`\n${passCount}/${results.length} logic checks passed\n`);
for (const r of results) {
  console.log(`[${r.status}] ${r.name}` + (r.notes ? ` (${r.notes})` : ''));
  if (r.status === 'FAIL') {
    console.log('   expected:', JSON.stringify(r.expected));
    console.log('   actual  :', JSON.stringify(r.actual));
  }
}
fs.writeFileSync(require('path').join(__dirname,'results.json'), JSON.stringify(results, null, 2));
