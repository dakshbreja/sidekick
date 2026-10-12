// Copyright 2026 Daksh Breja. All rights reserved.
// Pure decoding, shared with the browser. Imported text stays inert source data.
export function decodeTextImport(filename, bytes) {
  if (typeof filename !== 'string' || !/\.(txt|md|vtt|srt)$/i.test(filename)) {
    throw new Error('Choose a .txt, .md, .vtt, or .srt text export.');
  }
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > 60000) {
    throw new Error('Choose a text export under 60 KB.');
  }
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new Error('This file must be a UTF-8 text export.'); }
  if (!text.trim() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) {
    throw new Error('Choose a nonempty text export, without binary content.');
  }
  return text;
}

export const TEXT_IMPORT_MODULE = `export const decodeTextImport = ${decodeTextImport.toString()};`;
