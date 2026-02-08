import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '@/test-utils/renderWithProviders';

import { HomePage } from './HomePage';

describe('HomePage', () => {
  it('renders the heading', () => {
    renderWithProviders(<HomePage />);
    expect(screen.getByText('home.heading')).toBeInTheDocument();
  });

  it('renders the hello button', () => {
    renderWithProviders(<HomePage />);
    expect(screen.getByText('home.hello_button')).toBeInTheDocument();
  });
});
