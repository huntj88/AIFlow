import { useTranslation } from 'react-i18next';

import { useHello } from '@/hooks/useHello';

export function HomePage() {
  const { t } = useTranslation();
  const { data, loading, error, fetchHello } = useHello();

  return (
    <div>
      <h2 className="mb-4 text-2xl font-semibold">{t('home.heading')}</h2>

      <button
        onClick={fetchHello}
        disabled={loading}
        className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-white disabled:opacity-50"
      >
        {loading ? '…' : t('home.hello_button')}
      </button>

      {data && (
        <p className="mt-4" data-testid="hello-response">
          {t('home.response_label')} {data}
        </p>
      )}

      {error && (
        <p className="mt-4 text-red-500" data-testid="hello-error">
          {error}
        </p>
      )}
    </div>
  );
}
