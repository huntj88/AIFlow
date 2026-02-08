import { useTranslation } from 'react-i18next';

export function HomePage() {
  const { t } = useTranslation();

  return (
    <div>
      <h2 className="mb-4 text-2xl font-semibold">{t('home.heading')}</h2>
      {/* Hello button will be wired up in Task 06 (Integration) */}
    </div>
  );
}
