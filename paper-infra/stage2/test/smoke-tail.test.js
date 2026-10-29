import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { tailDecoder, startSmokeTail } from '../../scripts/smoke-tail.mjs';

test('chunked tail JSON reports outcome and exceptions without request headers or URLs', () => {
  const reports = [], decode = tailDecoder(value => reports.push(value));
  const event = JSON.stringify({ outcome: 'exception', cpuTime: 2, wallTime: 30,
    event: { request: { method: 'POST', url: 'https://private.example', headers: { authorization: 'SECRET_REQUEST_HEADER' } }, response: { status: 500 } },
    exceptions: [{ name: 'TypeError', message: 'Error with braces {x} https://private.example/?token=secret token=unsafe', stack: 'SECRET_STACK' }] });
  decode('CLI notice\n' + event.slice(0, 43)); decode(event.slice(43, 97)); decode(event.slice(97) + '\n');
  assert.equal(reports.length, 1); assert.equal(reports[0].method, 'POST'); assert.equal(reports[0].outcome, 'exception');
  const text = JSON.stringify(reports);
  for (const hidden of ['SECRET_REQUEST_HEADER', 'SECRET_STACK', 'private.example', 'unsafe']) assert.ok(!text.includes(hidden));
});
test('tail subprocess uses argument arrays and closes the temporary trace', async () => {
  const reports = [], child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  let killed = false; child.kill = () => { killed = true; child.emit('close', 0); };
  const trace = await startSmokeTail(value => reports.push(value), (_, args, options) => {
    assert.ok(args.includes('rv-pdf-finder')); assert.equal(options.shell, undefined); assert.equal(options.windowsHide, true);
    queueMicrotask(() => child.stdout.write('Connected to rv-pdf-finder, waiting for logs...\n'));
    return child;
  });
  assert.equal(reports[0].connected, true);
  child.stdout.write(JSON.stringify({ outcome: 'ok', event: { request: { method: 'GET' } } }));
  assert.equal(reports[1].outcome, 'ok'); await trace.stop(); assert.equal(killed, true);
});
