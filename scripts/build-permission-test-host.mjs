import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

assert.equal(process.platform, 'win32', 'Authorization tests require Windows WebView2.');
const result = spawnSync(
  process.env.PAM_TEST_CARGO || 'cargo',
  [
    'rustc',
    '--manifest-path',
    'src-tauri/Cargo.toml',
    '--locked',
    '--target',
    'x86_64-pc-windows-msvc',
    '--features',
    'process-tests,custom-protocol',
    '--example',
    'permission-test-host',
    '--',
    '-C',
    'link-arg=/MANIFEST:EMBED',
    '-C',
    "link-arg=/MANIFESTDEPENDENCY:type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'",
  ],
  { stdio: 'inherit', windowsHide: true },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
