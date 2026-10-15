import { parseHTML } from 'linkedom';

// Keyword anchoring, URL removal and candidate exclusions are informed by
// dreamhunter2333/cloudflare_temp_email (MIT). See THIRD_PARTY_NOTICES.md.
const KEYWORD = '(?:验证码|驗證碼|校验码|校驗碼|认证码|認證碼|确认码|確認碼|动态码|動態碼|动态密码|一次性密码|登录码|登入码|安全码|verification\\s+code|security\\s+code|confirmation\\s+code|authentication\\s+code|login\\s+code|sign[ -]?in\\s+code|log[ -]?in\\s+code|one[ -]?time\\s+(?:password|passcode|code)|\\bOTP\\b|\\bpasscode\\b)';
const CANDIDATE = /(?<![\w+./-])([A-Za-z0-9]{4,10})(?![\w/.-])/g;
const CONTEXT = new RegExp(KEYWORD, 'giu');

export function htmlToVerificationText(html = '') {
  if (!html) return '';
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  document.querySelectorAll('script,style,title,head,template,noscript,iframe,object,embed,svg,form,img,video,audio').forEach(el => el.remove());
  return (document.body.innerText || '').replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ')
    .split('\n').map(line => line.trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function verificationBody({ text, content, html } = {}) {
  const body = typeof text === 'string' && text.trim() ? text : htmlToVerificationText(content || html || '');
  // Do not expose the existing public attachment endpoints through the portal.
  return body.replace(/(?:https?:\/\/[^\s<>"']+)?\/(?:attachments|api\/oss)\/[^\s<>"']+/gi, '[附件已隐藏]');
}

export function classifyVerificationEmail(mail = {}) {
  // Bound HTML before constructing a DOM; attachments or giant templates must
  // not make classification consume the Worker's entire memory/CPU budget.
  const boundedMail = { text: String(mail.text || '').slice(0, 20000),
    content: String(mail.content || mail.html || '').slice(0, 100000) };
  const text = [String(mail.subject || '').slice(0, 1000), verificationBody(boundedMail).slice(0, 20000)].join('\n')
    .replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, '')
    .replace(/[\uFF10-\uFF19\uFF21-\uFF3A\uFF41-\uFF5A]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/\b(?:https?:\/\/|www\.)[^\s<>"']+/gi, ' ')
    .replace(/[\w.+-]+@[\w.-]+/g, ' ');
  const contexts = [...text.matchAll(CONTEXT)];
  if (!contexts.length) return { isVerification: 0, code: '' };
  const codes = new Set();
  for (const match of text.matchAll(CANDIDATE)) {
    const code = match[1];
    if (!/\d/.test(code) || (/^\d+$/.test(code) && (code.length > 8 || /^(?:19|20)\d{2}$/.test(code) || /^(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])$/.test(code)))) continue;
    const before = text.slice(Math.max(0, match.index - 24), match.index);
    const after = text.slice(match.index + code.length, match.index + code.length + 12);
    if (/(?:[$€£¥]|(?:order|invoice|tracking|account|订单|订单号|金额|日期)\s*(?:id|number|no\.?)?\s*[:：#]?)\s*$/i.test(before)
      || /^\s*(?:USD|EUR|GBP|CNY|RMB|元|分钟|小时|seconds?|minutes?)(?:\b|$)/i.test(after)
      || /\d[.,:]$/.test(before) || /^[.,:]\d/.test(after)) continue;
    const anchored = contexts.some(context => {
      const end = context.index + context[0].length;
      const followsKeyword = match.index >= end;
      const gap = followsKeyword ? text.slice(end, match.index)
        : context.index >= match.index + code.length ? text.slice(match.index + code.length, context.index) : null;
      if (gap === null || gap.length > 60 || gap.split('\n').length > 4) return false;
      if (followsKeyword) {
        // A label/delimiter is required, not merely a keyword somewhere nearby.
        // Preserve ambiguous alternatives so both candidates are withheld.
        const labelGap = gap.replace(/[A-Za-z0-9]{4,10}\s*(?:or\b|或者|或|\/)\s*/gi, '');
        return /^(?:[\s:：=—–'"“”‘’()[\]【】-]|\b(?:is|was|below)\b|是|为|為|如下)*$/iu.test(labelGap);
      }
      if (/[\u3400-\u9fff]/.test(context[0])) {
        return /^[\s:：'"“”‘’()[\]【】]*[是为為]?(?:您|你)?的?(?:登录|登入|安全|邮箱|账号|账户)?\s*$/u.test(gap);
      }
      return /^\s+(?:is|was)\s+(?:your|the)\s+(?:[a-z][a-z0-9&'-]{0,39}\s+){0,3}$/iu.test(gap);
    });
    if (anchored) codes.add(code);
  }
  // Conflicting codes are deliberately withheld rather than guessing which mail to publish.
  return codes.size === 1 ? { isVerification: 1, code: [...codes][0] } : { isVerification: 0, code: '' };
}
