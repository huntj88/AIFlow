import * as fs from 'node:fs';

import { E2E_TEST_WORKSPACE_ROOT } from './helpers/machine-helpers';

// eslint-disable-next-line import/no-default-export
export default function globalSetup() {
  fs.mkdirSync(E2E_TEST_WORKSPACE_ROOT, { recursive: true });
}
