<template>
  <main class="verify-page">
    <header class="verify-header">
      <a class="brand" href="/verify" aria-label="验证码邮件首页"><span class="brand-icon">✉</span> rxkflo<span>.tech</span></a>
      <span class="header-label">验证码邮件</span>
    </header>

    <section class="intro">
      <span class="eyebrow">YOUR INBOX, SIMPLIFIED</span>
      <h1>验证码，即刻查看。</h1>
      <p>输入分配给你的邮箱名称，查看最近 30 分钟的验证码邮件。</p>
      <form class="query-form" @submit.prevent="search">
        <label for="mailbox-name">邮箱名称</label>
        <div class="query-row">
          <div class="mailbox-input"><input id="mailbox-name" v-model="name" type="text" placeholder="例如 alice" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="64" required><span>@rxkflo.tech</span></div>
          <button class="primary" type="submit" :disabled="loading">{{ loading ? '查询中…' : '查看邮件' }} <span aria-hidden="true">→</span></button>
        </div>
        <span class="query-help">无需登录 · 仅展示验证码邮件 · 正文只读</span>
      </form>
    </section>

    <section v-if="searched" class="results" aria-label="查询结果">
      <div class="result-toolbar">
        <div><h2>{{ activeEmail }}</h2><p><span class="live-dot"></span>{{ paused ? '自动刷新已暂停' : '每 5 秒自动刷新' }}<span v-if="updatedAt"> · {{ updatedAt }} 更新</span></p></div>
        <button class="secondary" :disabled="loading" @click="refresh">↻ 刷新</button>
      </div>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <div v-if="!messages.length && !loading && !error" class="empty-state">
        <span class="empty-icon" aria-hidden="true">✉</span><h3>暂时没有验证码邮件</h3><p>收到符合条件的邮件后会自动显示。请确认邮箱名称正确。</p>
      </div>
      <div v-if="messages.length" class="message-layout">
        <div class="message-list">
          <button v-for="message in messages" :key="message.emailId" class="message-card" :class="{ selected: selected?.emailId === message.emailId }" @click="openMessage(message)">
            <span class="message-meta"><strong>{{ message.senderName || message.sender }}</strong><time>{{ formatTime(message.createTime) }}</time></span>
            <span class="message-subject">{{ message.subject || '无主题' }}</span>
            <span class="message-code">{{ message.code }}</span>
          </button>
          <button v-if="nextCursor" class="load-more secondary" :disabled="loading" @click="loadMore">加载更多</button>
        </div>
        <article class="message-detail" aria-label="邮件详情">
          <div v-if="selected">
            <div class="code-panel"><span>验证码</span><div><strong>{{ selected.code }}</strong><button class="copy-button" @click="copyCode">{{ copied ? '已复制 ✓' : '复制验证码' }}</button></div></div>
            <h3>{{ selected.subject || '无主题' }}</h3>
            <dl><div><dt>发件人</dt><dd>{{ selected.sender }}</dd></div><div><dt>收到时间</dt><dd>{{ formatDate(selected.createTime) }}</dd></div></dl>
            <div class="body-label">邮件正文</div>
            <p v-if="detailLoading" class="detail-status" role="status">正在加载正文…</p>
            <p v-else-if="detailError" class="error" role="alert">{{ detailError }}</p>
            <pre v-else class="message-body">{{ selected.body || '这封邮件没有文字正文。' }}</pre>
          </div>
          <div v-else class="detail-placeholder">选择一封邮件查看正文</div>
        </article>
      </div>
    </section>
    <p v-else-if="error" class="error initial-error" role="alert">{{ error }}</p>

    <footer>仅展示最近 30 分钟的验证码邮件。知道邮箱名称的人均可查询。<br>邮件可能已失效，请以发送方提示为准。</footer>
    <span class="sr-only" role="status">{{ copied ? '验证码已复制' : '' }}</span>
  </main>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';

const name = ref('');
const activeEmail = ref('');
const searched = ref(false);
const loading = ref(false);
const error = ref('');
const messages = ref([]);
const nextCursor = ref(null);
const selected = ref(null);
const detailLoading = ref(false);
const detailError = ref('');
const copied = ref(false);
const updatedAt = ref('');
const paused = ref(false);
let activeName = '';
let generation = 0;
let detailGeneration = 0;
let timer;
let copyTimer;
let retryAt = 0;
let serverOffset = 0;
const controllers = new Set();

async function request(action, payload) {
  const controller = new AbortController();
  controllers.add(controller);
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`/api/verify/${action}`, {
      method: 'POST', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: controller.signal,
    });
    const result = await response.json();
    if (response.status === 429) retryAt = Date.now() + 60000;
    if (!response.ok) throw new Error(result.error || '查询失败，请稍后重试');
    return result;
  } finally { clearTimeout(timeout); controllers.delete(controller); }
}

function parseTime(time) {
  return Date.parse(time.includes('T') ? time : time.replace(' ', 'T') + 'Z');
}
function formatTime(time) { return new Date(parseTime(time)).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }); }
function formatDate(time) { return new Date(parseTime(time)).toLocaleString('zh-CN', { hour12: false }); }
function pruneExpired() {
  const cutoff = Date.now() + serverOffset - 30 * 60 * 1000;
  messages.value = messages.value.filter(message => parseTime(message.createTime) > cutoff);
  if (selected.value && parseTime(selected.value.createTime) <= cutoff) {
    selected.value = null;
    detailGeneration++;
    detailLoading.value = false;
  }
}
function showError(cause) { return cause.name === 'AbortError' ? '连接超时，请重试' : cause.message; }

async function search() {
  const value = name.value.trim().toLowerCase();
  if (!value || value.includes('@')) { error.value = '请输入 @ 前面的邮箱名称'; return; }
  generation++;
  detailGeneration++;
  for (const controller of controllers) controller.abort();
  activeName = value;
  activeEmail.value = `${value}@rxkflo.tech`;
  searched.value = true;
  messages.value = [];
  selected.value = null;
  detailLoading.value = false;
  nextCursor.value = null;
  loading.value = false;
  await fetchList(false);
}
async function fetchList(append = false) {
  if (loading.value || !activeName || Date.now() < retryAt) return;
  const current = generation;
  loading.value = true;
  error.value = '';
  try {
    const result = await request('list', { name: activeName, ...(append ? { cursor: nextCursor.value } : {}) });
    if (current !== generation) return;
    serverOffset = Date.parse(result.serverTime) - Date.now();
    const hadOlderPages = messages.value.length > 20;
    const tail = result.messages.at(-1);
    const older = !append && hadOlderPages && result.nextCursor && tail
      ? messages.value.filter(item => parseTime(item.createTime) < parseTime(tail.createTime)
        || (item.createTime === tail.createTime && item.emailId < tail.emailId)) : [];
    messages.value = append
      ? [...new Map([...messages.value, ...result.messages].map(item => [item.emailId, item])).values()]
      : [...result.messages, ...older];
    if (append || !older.length) nextCursor.value = result.nextCursor;
    updatedAt.value = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    if (selected.value && !messages.value.some(message => message.emailId === selected.value.emailId)) {
      selected.value = null;
      detailGeneration++;
    }
    pruneExpired();
  } catch (cause) { if (current === generation) error.value = showError(cause); }
  finally { if (current === generation) loading.value = false; }
}
function refresh() { return fetchList(false); }
function loadMore() { return fetchList(true); }
async function openMessage(message) {
  const current = ++detailGeneration;
  const currentMailbox = generation;
  selected.value = { ...message };
  detailLoading.value = true;
  detailError.value = '';
  copied.value = false;
  try {
    const result = await request('detail', { name: activeName, emailId: message.emailId });
    if (current !== detailGeneration || currentMailbox !== generation) return;
    selected.value = result.message;
    pruneExpired();
  } catch (cause) { if (current === detailGeneration) detailError.value = showError(cause); }
  finally { if (current === detailGeneration) detailLoading.value = false; }
}
async function copyCode() {
  if (!selected.value) return;
  try {
    await navigator.clipboard.writeText(selected.value.code);
    copied.value = true;
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => { copied.value = false; }, 2000);
  } catch { detailError.value = '复制失败，请手动选择验证码复制'; }
}
function visibilityChanged() {
  paused.value = document.hidden;
  pruneExpired();
  if (!document.hidden && searched.value) refresh();
}
onMounted(() => {
  document.title = '验证码邮件 · rxkflo.tech';
  paused.value = document.hidden;
  document.addEventListener('visibilitychange', visibilityChanged);
  timer = setInterval(() => {
    pruneExpired();
    if (!document.hidden && searched.value) refresh();
  }, 5000);
});
onUnmounted(() => {
  generation++;
  detailGeneration++;
  clearInterval(timer);
  clearTimeout(copyTimer);
  for (const controller of controllers) controller.abort();
  document.removeEventListener('visibilitychange', visibilityChanged);
});
</script>

<style scoped>
.verify-page{min-height:100vh;background:#f7f9fc;color:#17243b;padding:0 32px 36px;font-family:Inter,"PingFang SC","Microsoft YaHei",sans-serif}
.verify-header{max-width:1120px;margin:auto;height:88px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #e5eaf2}
.brand{display:flex;align-items:center;text-decoration:none;color:#17243b;font-size:21px;font-weight:750;letter-spacing:-.5px}.brand>span:last-child{color:#7f8b9e}.brand-icon{display:grid;place-items:center;background:#315cf6;color:white;width:36px;height:36px;border-radius:11px;margin-right:10px;font-size:24px}.header-label{font-size:13px;color:#748198}
.intro{max-width:720px;margin:78px auto 48px;text-align:center}.eyebrow{font-size:11px;font-weight:750;letter-spacing:2px;color:#4265d9}h1{font-size:clamp(32px,5vw,48px);font-weight:750;letter-spacing:-1.8px;line-height:1.25;margin:16px 0}.intro>p{font-size:15px;color:#6d7b90;line-height:1.8}
.query-form{text-align:left;margin-top:34px;background:white;border:1px solid #e3e9f2;border-radius:18px;padding:24px;box-shadow:0 8px 35px #263c6510}.query-form label{display:block;font-size:12px;font-weight:650;margin-bottom:9px;color:#53627a}.query-row{display:flex;gap:10px}.mailbox-input{display:flex;align-items:center;border:1px solid #dce3ee;border-radius:9px;flex:1;min-width:0;background:#fcfdff}.mailbox-input:focus-within{border-color:#5479ff;box-shadow:0 0 0 3px #315cf612}.mailbox-input input{padding:14px;min-width:0;width:100%;color:#17243b}.mailbox-input span{padding-right:14px;font-size:14px;color:#7e8ca0;white-space:nowrap}.query-help{display:block;margin-top:13px;font-size:11px;color:#8a95a7}
button{cursor:pointer;transition:background .15s}button:disabled{opacity:.55;cursor:wait}button:focus-visible,a:focus-visible{outline:3px solid #a2b5ff;outline-offset:3px}.primary{background:#315cf6;color:#fff;padding:0 23px;border-radius:9px;white-space:nowrap;font-weight:600}.primary:hover{background:#2349d6}.primary span{margin-left:14px}.secondary{padding:9px 16px;background:white;border:1px solid #dce3ee;border-radius:8px;color:#52627a;font-size:12px}.secondary:hover{background:#edf2ff}
.results{max-width:1120px;margin:0 auto}.result-toolbar{display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;gap:12px}.result-toolbar h2{font-size:16px;font-weight:650;overflow-wrap:anywhere}.result-toolbar p{color:#8a95a7;font-size:11px;margin-top:5px}.live-dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:#2baa85;margin-right:6px}.message-layout{display:grid;grid-template-columns:340px 1fr;gap:20px;align-items:start}.message-list{display:grid;gap:10px}.message-card{text-align:left;background:white;border:1px solid #e2e8f1;border-radius:12px;padding:18px;width:100%;min-width:0;color:#17243b}.message-card:hover{border-color:#a8baff}.message-card.selected{border-color:#5478ff;background:#f1f5ff;box-shadow:0 0 0 1px #5478ff}.message-meta{display:flex;justify-content:space-between;align-items:start;gap:12px;font-size:12px}.message-meta strong{font-weight:650;overflow-wrap:anywhere}.message-meta time{white-space:nowrap;color:#8a95a7;font-size:11px}.message-subject{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:#768397;margin:8px 0 13px}.message-code{display:inline-block;background:#eef2ff;color:#3159df;border-radius:6px;padding:5px 10px;font:650 18px ui-monospace,monospace;letter-spacing:2px}.load-more{justify-self:center}
.message-detail{background:white;border:1px solid #e2e8f1;border-radius:14px;padding:28px;min-width:0;min-height:320px}.code-panel{background:#f1f5ff;border:1px solid #e2eaff;padding:18px 20px;border-radius:10px;margin-bottom:24px}.code-panel>span{font-size:11px;color:#7485b0}.code-panel>div{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:8px}.code-panel strong{font:700 clamp(22px,3vw,32px) ui-monospace,monospace;letter-spacing:3px;color:#3159df;overflow-wrap:anywhere}.copy-button{color:#3159df;font-size:12px;background:white;border:1px solid #d4deff;border-radius:6px;padding:8px 10px;white-space:nowrap}.message-detail h3{font-size:18px;font-weight:650;overflow-wrap:anywhere}.message-detail dl{font-size:11px;color:#8792a3;margin-top:12px}.message-detail dl>div{display:flex;gap:12px;margin-top:5px}.message-detail dt{flex-shrink:0;min-width:48px}.message-detail dd{overflow-wrap:anywhere}.body-label{font-size:11px;color:#8b97a9;border-top:1px solid #eef1f6;padding-top:22px;margin-top:22px}.message-body{font-family:inherit;font-size:13px;line-height:1.9;white-space:pre-wrap;overflow-wrap:anywhere;color:#44536a;padding-top:12px}.detail-placeholder{display:grid;place-items:center;min-height:260px;color:#99a4b4;font-size:13px}.detail-status{padding-top:16px;color:#8792a3;font-size:12px}.empty-state{background:white;border:1px dashed #d9e1ed;border-radius:14px;padding:55px 20px;text-align:center}.empty-icon{font-size:36px;color:#9baed8}.empty-state h3{font-size:15px;margin:12px 0 8px;font-weight:600}.empty-state p{font-size:12px;color:#8995a7}.error{background:#fff1f1;color:#b84040;border:1px solid #f3d7d7;border-radius:9px;padding:12px 15px;font-size:12px;margin-bottom:16px}.initial-error{max-width:720px;margin:0 auto}footer{text-align:center;font-size:11px;line-height:1.9;color:#96a0b0;margin:48px auto 0}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}
@media(max-width:767px){.verify-page{padding:0 18px 28px}.verify-header{height:70px}.intro{margin:48px auto 30px}.intro>p{font-size:13px}.query-form{padding:18px;margin-top:26px}.query-row{flex-direction:column}.primary{height:46px}.message-layout{grid-template-columns:1fr}.message-list{grid-template-columns:1fr}.message-detail{padding:20px}.result-toolbar h2{font-size:14px}.result-toolbar p{font-size:10px}.query-help{font-size:10px}.mailbox-input span{font-size:12px}.brand{font-size:19px}footer{margin-top:32px}}
</style>
