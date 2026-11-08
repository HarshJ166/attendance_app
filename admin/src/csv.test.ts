import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCsv } from './csv.ts';

test('parseCsv: quotes, commas and newlines inside quotes, "" escapes, CRLF, BOM, blank lines', () => {
  const text = '﻿name,email,places\r\n"Patil, Asha",asha@x.in,"Office A; Office B"\r\n\r\n"Say ""hi""",b@x.in,"line1\nline2"\nRavi,ravi@x.in,\n';
  assert.deepEqual(parseCsv(text), [
    ['name', 'email', 'places'],
    ['Patil, Asha', 'asha@x.in', 'Office A; Office B'],
    ['Say "hi"', 'b@x.in', 'line1\nline2'],
    ['Ravi', 'ravi@x.in', ''],
  ]);
});

test('parseCsv: last row without a trailing newline', () => {
  assert.deepEqual(parseCsv('a,b\n1,2'), [['a', 'b'], ['1', '2']]);
});
