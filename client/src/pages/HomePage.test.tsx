import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '@/test-utils/renderWithProviders';

import { HomePage } from './HomePage';

describe('HomePage', () => {
  it('renders the heading with translation key', () => {
    renderWithProviders(<HomePage />);
    // i18n is mocked — returns the key itself
    expect(screen.getByText('home.heading')).toBeInTheDocument();
  });
});
