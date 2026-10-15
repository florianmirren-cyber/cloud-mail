import app from './hono/webs';
import { email } from './email/email';
import userService from './service/user-service';
import verifyRecordService from './service/verify-record-service';
import emailService from './service/email-service';
import kvObjService from './service/kv-obj-service';
import oauthService from './service/oauth-service';
import analysisService from './service/analysis-service';
import { serveAssets } from './utils/asset-response';
import verificationApp from './api/verify-api.js';
export default {
	 async fetch(req, env, ctx) {

		const url = new URL(req.url)

		if (url.pathname === '/api/verify' || url.pathname.startsWith('/api/verify/')) {
			return verificationApp.fetch(req, env, ctx);
		}

		if (url.pathname.startsWith('/api/')) {
			url.pathname = url.pathname.replace('/api', '')
			req = new Request(url.toString(), req)
			return app.fetch(req, env, ctx);
		}

		 if (['/static/','/attachments/'].some(p => url.pathname.startsWith(p))) {
			 return await kvObjService.toObjResp( { env }, url.pathname.substring(1));
		 }

		const response = await serveAssets(req, env.assets);
		if (url.pathname === '/verify' || url.pathname === '/verify/') {
			const headers = new Headers(response.headers);
			headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
			headers.set('Referrer-Policy', 'no-referrer');
			return new Response(response.body, { status: response.status, headers });
		}
		return response;
	},
	email: email,
	async scheduled(c, env, ctx) {
		if (c.cron === '*/30 * * * *') {
			await analysisService.refreshEchartsCache({ env })
			return;
		}

		await verifyRecordService.clearRecord({ env })
		await userService.resetDaySendCount({ env })
		await emailService.completeReceiveAll({ env })
		await emailService.autoClean({ env })
		await analysisService.refreshEchartsCache({ env })
		await oauthService.clearNoBindOathUser({ env })
	},
};
