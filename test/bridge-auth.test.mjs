import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { spawn } from 'node:child_process'

async function freePort() {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  return port
}

const port = await freePort()
const child = spawn(process.execPath, ['dist/bridgeMain.js'], {
  env: { ...process.env, MCP_BRIDGE_PORT: String(port) },
  stdio: ['ignore', 'ignore', 'pipe'],
})

let stderr = ''
child.stderr.on('data', (chunk) => { stderr += chunk.toString() })

try {
  const deadline = Date.now() + 5_000
  let auth
  while (!auth && Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/auth`, { cache: 'no-store' })
      if (response.ok) auth = await response.json()
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }

  assert.ok(auth?.token, `Bridge did not expose an auth token: ${stderr}`)
  assert.equal(auth.port, port)

  const unauthorized = await fetch(`http://127.0.0.1:${port}/v1/health`)
  assert.equal(unauthorized.status, 401)

  const authorized = await fetch(`http://127.0.0.1:${port}/v1/health`, {
    headers: { 'X-MCP-Bridge-Token': auth.token },
  })
  assert.equal(authorized.status, 200)
  assert.equal((await authorized.json()).bridge, 'running')
} finally {
  child.kill('SIGTERM')
  await once(child, 'exit')
}

console.log('bridge auth integration test passed')
