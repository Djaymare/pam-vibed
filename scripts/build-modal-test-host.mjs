import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

assert.equal(process.platform, 'win32', 'WebView2 tests require Windows.');
// Examples do not receive the production binary's Windows resource manifest.
// Common Controls v6 is needed by the Tauri window before WebView2 can load.
const result = spawnSync(process.env.PAM_TEST_CARGO || 'cargo', [
  'rustc', '--manifest-path', 'src-tauri/Cargo.toml', '--locked',
  '--target', 'x86_64-pc-windows-msvc', '--example', 'modal-test-host', '--',
  '-C', 'link-arg=/MANIFEST:EMBED',
  '-C', "link-arg=/MANIFESTDEPENDENCY:type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'",
], { stdio: 'inherit', windowsHide: true });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
