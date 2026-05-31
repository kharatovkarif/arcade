import crypto from 'crypto';

export function verifyTelegramData(initData, botToken) {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;
    params.delete('hash');

    const dataCheckString = [...params.entries()]
      .map(([k, v]) => `${k}=${v}`)
      .sort()
      .join('\n');

    const secretKey = crypto
      .createHmac('sha256', 'WebAppData')
      .update(botToken)
      .digest();

    const calcHash = crypto
      .createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    if (calcHash !== hash) return null;

    const userRaw = params.get('user');
    if (!userRaw) return null;
    const user = JSON.parse(userRaw);

    return {
      tg_id: user.id,
      username: user.username || null,
      first_name: user.first_name || null,
      language_code: user.language_code || 'ru',
      start_param: params.get('start_param') || null,
    };
  } catch (e) {
    return null;
  }
}