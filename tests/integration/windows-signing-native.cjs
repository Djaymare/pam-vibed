const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, readFile, writeFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join, dirname, resolve } = require('node:path');
const { createHash } = require('node:crypto');

test('Authenticode natif : signature de confiance, autre editeur et octets alteres', async (t) => {
  assert.equal(process.platform, 'win32', 'Cette suite exige Windows.');
  const { verifyWindowsSignature } = await import('../../scripts/windows-signing.mjs');
  const file = process.env.PAM_SIGNTOOL_PATH;
  const thumbprint = process.env.PAM_SIGNATURE_FIXTURE_THUMBPRINT;
  const sha256 = process.env.PAM_SIGNATURE_FIXTURE_SHA256;
  assert.ok(
    file && thumbprint && sha256,
    'Fournir SignTool et les empreintes de sa fixture approuvee.',
  );
  const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
  const original = await readFile(file);
  assert.equal(hash(original), sha256.toLowerCase());
  assert.equal((await verifyWindowsSignature(file, sha256, thumbprint)).status, 'Valid');
  const wrongPublisher = (thumbprint[0] === 'A' ? 'B' : 'A') + thumbprint.slice(1);
  await assert.rejects(verifyWindowsSignature(file, sha256, wrongPublisher), (e) =>
    /Signataire inattendu/.test(e.stderr),
  );
  const directory = await mkdtemp(join(tmpdir(), 'pam-signature-native-'));
  t.after(async () => {
    assert.equal(dirname(directory), resolve(tmpdir()));
    await rm(directory, { recursive: true, force: true });
  });
  const tampered = Buffer.from(original);
  assert.ok(tampered.length > 0x40);
  tampered[0x40] ^= 1;
  const copy = join(directory, 'altered [1] $().exe');
  await writeFile(copy, tampered);
  // Use the changed file's hash so this reaches the signature integrity check.
  await assert.rejects(verifyWindowsSignature(copy, hash(tampered), thumbprint), (e) =>
    /Signature invalide/.test(e.stderr),
  );
  assert.deepEqual(await readFile(file), original, 'La fixture approuvee doit rester intacte.');
});
