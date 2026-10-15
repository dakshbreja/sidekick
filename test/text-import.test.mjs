import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeTextImport, TEXT_IMPORT_MODULE } from '../src/text-import.js';

const encode = text => new TextEncoder().encode(text);

test('vendor-neutral note and transcript exports retain exact inert source text', () => {
  for (const filename of ['notes.txt', 'notes.MD', 'lecture.vtt', 'lecture.srt']) {
    const text = '<script>do not execute</script>\n1\n00:01 --> 00:02\nSynthetic lecture.';
    assert.equal(decodeTextImport(filename, encode(text)), text);
  }
});

test('text imports reject incompatible formats, binary, invalid UTF-8 and oversized content', () => {
  for (const filename of ['lecture.mp3', 'notes.pdf', 'notes.txt.exe', 'notes']) {
    assert.throws(() => decodeTextImport(filename, encode('Synthetic text')), /text export/);
  }
  assert.throws(() => decodeTextImport('notes.txt', new Uint8Array([0xff,0xfe,0xc0])), /UTF-8/);
  assert.throws(() => decodeTextImport('notes.txt', encode('a\0b')), /binary/);
  assert.throws(() => decodeTextImport('notes.txt', encode('  \n')), /nonempty/);
  assert.throws(() => decodeTextImport('notes.txt', encode('é'.repeat(30001))), /60 KB/);
  assert.equal(decodeTextImport('notes.txt', encode('x'.repeat(60000))).length, 60000);
});

test('served browser decoder has the same validation as the source module', async () => {
  const browser = await import('data:text/javascript,' + encodeURIComponent(TEXT_IMPORT_MODULE));
  assert.equal(browser.decodeTextImport('notes.md', encode('Synthetic notes')), 'Synthetic notes');
  assert.throws(() => browser.decodeTextImport('notes.txt', new Uint8Array([0xff])), /UTF-8/);
});
