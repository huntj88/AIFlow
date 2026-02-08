import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import { type ReactElement } from 'react';
import { MemoryRouter } from 'react-router';

import { ThemeProvider } from '@/app/providers/ThemeProvider';

interface ProviderOptions {
  initialRoute?: string;
}

export function renderWithProviders(
  ui: ReactElement,
  options?: ProviderOptions & Omit<RenderOptions, 'wrapper'>,
): RenderResult {
  const { initialRoute = '/', ...renderOptions } = options ?? {};

  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <MemoryRouter initialEntries={[initialRoute]}>
        <ThemeProvider>{children}</ThemeProvider>
      </MemoryRouter>
    );
  }

  return render(ui, { wrapper: Wrapper, ...renderOptions });
}
