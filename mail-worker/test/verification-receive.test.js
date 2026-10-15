import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ rows: [], accounts: [] }));
vi.mock('../src/entity/orm', () => ({ default: () => ({
  insert: () => ({ values: values => {
    const save = async () => { const row = { ...values, emailId: state.rows.length + 1 }; state.rows.push(row); return row; };
    return { returning: () => ({ get: save }), run: save };
  } }),
  select: () => ({ from: () => ({ where: () => ({ all: async () => state.accounts }) }) }),
  update: () => ({ set: () => ({ where: () => ({ run: async () => {} }) }) }),
}) }));
vi.mock('../src/service/setting-service', () => ({ default: { query: async () => ({ noRecipient: 1 }) } }));
vi.mock('../src/service/role-service', () => ({ default: {
  selectByUserIds: async () => [{ userId: 2, banEmail: '', availDomain: '@rxkflo.tech' }],
  hasAvailDomainPerm: () => true,
  isBanEmail: () => false,
} }));

import emailService from '../src/service/email-service.js';

describe('classification is persisted in both real receipt paths', () => {
  beforeEach(() => { state.rows = []; state.accounts = []; });
  it('classifies external receive data without Workers AI', async () => {
    const row = await emailService.receive({ env: {} }, {
      subject: 'Login', text: 'Your verification code is 846291', content: '',
      code: '', accountId: 1, userId: 2, toEmail: 'alice@rxkflo.tech',
    }, [], '');
    expect(row).toMatchObject({ isVerification: 1, code: '846291' });
    const ordinary = await emailService.receive({ env: {} }, {
      subject: 'Order', text: 'Order 846291', content: '', code: 'AI-ONLY',
    }, [], '');
    expect(ordinary).toMatchObject({ isVerification: 0, code: 'AI-ONLY' });
  });
  it('classifies internal recipient copies instead of trusting sender metadata', async () => {
    state.accounts = [{ accountId: 1, userId: 2, email: 'alice@rxkflo.tech' }];
    await emailService.HandleOnSiteEmail({ env: { admin: 'florian@rxkflo.tech' } }, ['alice@rxkflo.tech'], {
      emailId: 20, subject: '登录', text: '验证码：846291', content: '',
      sendEmail: 'sender@rxkflo.tech', code: '', isVerification: 0,
    }, []);
    expect(state.rows[0]).toMatchObject({ accountId: 1, userId: 2, toEmail: 'alice@rxkflo.tech',
      type: 0, status: 0, isVerification: 1, code: '846291' });
  });
});
