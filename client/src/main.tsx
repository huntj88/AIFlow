import './index.css';
import '@/app/providers/i18n';

import { StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';

import { App } from '@/App';
import { i18n } from '@/app/providers/i18n';
import { ThemeProvider } from '@/app/providers/ThemeProvider';

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <Suspense
          fallback={<div className="flex min-h-screen items-center justify-center">Loading…</div>}
        >
          <App />
        </Suspense>
      </ThemeProvider>
    </I18nextProvider>
  </StrictMode>,
);
