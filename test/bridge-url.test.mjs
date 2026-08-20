import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_BRIDGE_URL, normalizeBridgeUrl } from '../extension/bridge-url.js'

test('默认地址使用本机回环端口', () => {
  assert.equal(DEFAULT_BRIDGE_URL, 'http://127.0.0.1:8787')
  assert.equal(normalizeBridgeUrl('http://localhost:8790/'), 'http://localhost:8790')
})

test('拒绝远程地址和非 HTTP 地址', () => {
  assert.throws(() => normalizeBridgeUrl('https://127.0.0.1:8787'), /必须是本机/)
  assert.throws(() => normalizeBridgeUrl('http://192.168.1.10:8787'), /必须是本机/)
  assert.throws(() => normalizeBridgeUrl('http://127.0.0.1:8787/bridge?x=1'), /只能包含本机地址和端口/)
})

console.log('bridge URL validation tests passed')
