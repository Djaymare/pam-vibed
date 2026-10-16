import test from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './fixtures/vue-harness.mjs';

test('launch arguments accept only a JSON array of strings, with a field-specific explanation', t => {
  const { argumentsError } = harness(t).feature('composables/fieldAccessibility.ts');
  for (const value of ['[]', '["--new-window", "{input}"]']) assert.equal(argumentsError(value), '');
  for (const value of ['broken', '{}', 'null', '[1]', '["ok", null]'])
    assert.match(argumentsError(value), /tableau JSON de textes/);
});
