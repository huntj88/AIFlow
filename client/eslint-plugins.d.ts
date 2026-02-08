declare module 'eslint-plugin-jsx-a11y' {
  import type { Linter } from 'eslint';
  const plugin: {
    flatConfigs: {
      recommended: Linter.Config;
      strict: Linter.Config;
    };
  };
  export default plugin;
}

declare module 'eslint-config-prettier' {
  import type { Linter } from 'eslint';
  const config: Linter.Config;
  export default config;
}

declare module 'eslint-plugin-import' {
  import type { ESLint } from 'eslint';
  const plugin: ESLint.Plugin;
  export default plugin;
}

declare module 'eslint-plugin-react-refresh' {
  import type { ESLint } from 'eslint';
  const plugin: ESLint.Plugin;
  export default plugin;
}
