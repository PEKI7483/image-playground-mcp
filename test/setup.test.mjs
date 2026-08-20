import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { applyChange, codexWithServer, jsonWithServer, npxCommand, parseArgs, planChange, targets } from '../bin/gpt-image-playground-mcp.mjs'

test('默认 setup 参数只读，显式选项互斥且端口受校验', () => {
  assert.deepEqual(parseArgs([]), { check: false, dryRun: false, all: false, agent: null, port: null })
  assert.deepEqual(parseArgs(['--agent=cursor', '--dry-run', '--port', '9001']), { check: false, dryRun: true, all: false, agent: 'cursor', port: 9001 })
  assert.throws(() => parseArgs(['--all', '--agent', 'cursor']), /不能同时使用/)
  assert.throws(() => parseArgs(['--port', '0']), /端口无效/)
})

test('npx bin 配置使用远程 GitHub 包启动 MCP server', () => {
  const output = JSON.parse(jsonWithServer('{}'))
  assert.deepEqual(output.mcpServers['gpt-image-playground'], {
    command: 'npx',
    args: ['-y', 'github:PEKI7483/image-playground-mcp'],
  })
})

test('JSON 配置合并 MCP server，保留其他 server 和环境变量，不写 token', () => {
  const input = JSON.stringify({ mcpServers: { existing: { command: 'keep-me' }, ["gpt-image-playground"]: { command: 'old', env: { KEEP: 'yes', MCP_BRIDGE_TOKEN: 'old-token' } } }, other: true })
  const output = JSON.parse(jsonWithServer(input))
  assert.equal(output.other, true)
  assert.deepEqual(output.mcpServers.existing, { command: 'keep-me' })
  assert.equal(output.mcpServers['gpt-image-playground'].command, 'npx')
  assert.deepEqual(output.mcpServers['gpt-image-playground'].args, ['-y', 'github:PEKI7483/image-playground-mcp'])
  assert.deepEqual(output.mcpServers['gpt-image-playground'].env, { KEEP: 'yes' })
})

test('JSON 配置只在显式端口参数存在时写入端口', () => {
  const output = JSON.parse(jsonWithServer('{}', 9001))
  assert.deepEqual(output.mcpServers['gpt-image-playground'].env, { MCP_BRIDGE_PORT: '9001' })
})

test('Windows 使用 npx.cmd，并定位 Windows Agent 配置目录', () => {
  const context = { platformName: 'win32', homeDir: 'C:\\Users\\Tester', env: { APPDATA: 'C:\\Users\\Tester\\AppData\\Roaming' } }
  assert.equal(npxCommand(context), 'npx.cmd')
  const paths = targets(context).map((target) => target.path)
  assert.ok(paths.includes('C:\\Users\\Tester\\.codex\\config.toml'))
  assert.ok(paths.includes('C:\\Users\\Tester\\AppData\\Roaming\\Claude\\claude_desktop_config.json'))
})

test('Codex TOML 替换目标区块并保留其他配置', () => {
  const input = '[mcp_servers.other]\ncommand = "other"\n\n[mcp_servers.gpt-image-playground]\ncommand = "old"\n\n[mcp_servers.gpt-image-playground.env]\nMCP_BRIDGE_TOKEN = "old"\n'
  const output = codexWithServer(input, 9001)
  assert.match(output, /\[mcp_servers\.other\]/)
  assert.doesNotMatch(output, /old/)
  assert.match(output, /command = "npx"/)
  assert.match(output, /MCP_BRIDGE_PORT = "9001"/)
  assert.doesNotMatch(output, /MCP_BRIDGE_TOKEN/)
  assert.equal((output.match(/\[mcp_servers\.gpt-image-playground\]/g) || []).length, 1)
})

test('Codex TOML 兼容带引号的服务器表名', () => {
  const input = '[mcp_servers."gpt-image-playground"]\ncommand = "old"\n'
  const output = codexWithServer(input)
  assert.equal((output.match(/mcp_servers\.["']?gpt-image-playground["']?\]/g) || []).length, 1)
  assert.doesNotMatch(output, /command = "old"/)
})

test('更新已有配置前生成备份，不覆盖其他配置', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gpt-image-playground-setup-'))
  try {
    const path = join(root, 'settings.json')
    await writeFile(path, JSON.stringify({ mcpServers: { existing: { command: 'keep' } } }) + '\n')
    const target = { name: 'test', label: 'Test', path, format: 'json' }
    const change = await planChange(target)
    const applied = await applyChange(change)
    assert.equal(applied.applied, true)
    const files = await readdir(root)
    assert.equal(files.length, 2)
    assert.ok(files.some((file) => file.startsWith('settings.json.backup-')))
    const output = JSON.parse(await readFile(path, 'utf8'))
    assert.equal(output.mcpServers.existing.command, 'keep')
    assert.equal(output.mcpServers['gpt-image-playground'].command, 'npx')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('新配置目标不创建备份目录中的额外文件', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gpt-image-playground-setup-'))
  try {
    const path = join(root, 'nested', 'settings.json')
    const target = { name: 'test', label: 'Test', path, format: 'json' }
    const change = await planChange(target)
    const applied = await applyChange(change)
    assert.equal(applied.backup, null)
    const output = JSON.parse(await readFile(path, 'utf8'))
    assert.equal(output.mcpServers['gpt-image-playground'].command, 'npx')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
