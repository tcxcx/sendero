import { cookies, headers } from 'next/headers';
import { detectLocale, LOCALE_COOKIE_NAME, LOCALE_HEADER_NAME } from '@sendero/locale';

export async function getRequestLocale(): Promise<string> {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);

  return detectLocale({
    cookie: cookieStore.get(LOCALE_COOKIE_NAME)?.value,
    acceptLanguage:
      headerStore.get(LOCALE_HEADER_NAME) ??
      headerStore.get('accept-language') ??
      headerStore.get('x-vercel-ip-locale'),
    country: headerStore.get('x-vercel-ip-country') ?? headerStore.get('cf-ipcountry'),
  });
}
