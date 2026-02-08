import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';

import commonEn from '@/locales/en/common.json';

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { common: commonEn },
    },
    defaultNS: 'common',
    fallbackLng: 'en',
    detection: {
      order: ['localStorage', 'navigator', 'htmlTag'],
      caches: ['localStorage'],
    },
    react: {
      useSuspense: true,
    },
    interpolation: {
      escapeValue: false, // React already escapes
    },
  });

export { i18n };
