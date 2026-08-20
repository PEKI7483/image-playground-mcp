#!/usr/bin/env node

import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { existsSync, realpathSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { dirname, join, resolve, win32 } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const PACKAGE_SPEC = 'github:PEKI7483/image-playground-mcp'
const SERVER_NAME = 'gpt-image-playground'
function runtimeContext(overrides = {}) {
  return {
    platformName: overrides.platformName ?? platform(),
    homeDir: overrides.homeDir ?? homedir(),
    env: overrides.env ?? process.env,
  }
}

function joinFor(context, ...parts) {
  return (context.platformName === 'win32' ? win32 : { join }).join(...parts)
}

function usage() {
  return `用法:
  npx ${PACKAGE_SPEC} setup [选项]
  node bin/gpt-image-playground-mcp.mjs setup [选项]

选项:
  --check              只检测，不修改文件（默认行为）
  --dry-run            显示将要修改的内容，但不写入文件
  --agent <名称>       只配置一个 Agent
  --all                配置所有已检测到的 Agent
  --port <端口>        将 MCP_BRIDGE_PORT 写入配置；默认不写入
  --help               显示帮助

支持的名称:
  codex, claude-code, gemini, cursor, cline, roo, windsurf, claude-desktop`
}

function parseArgs(argv) {
  const options = { check: false, dryRun: false, all: false, agent: null, port: null }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--check') options.check = true
    else if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--all') options.all = true
    else if (arg === '--help' || arg === '-h') options.help = true
    else if (arg === '--agent') {
      const value = argv[++index]
      if (!value || value.startsWith('--')) throw new Error('--agent 需要提供名称')
      options.agent = value
    }
    else if (arg.startsWith('--agent=')) options.agent = arg.slice('--agent='.length)
    else if (arg === '--port') options.port = parsePort(argv[++index])
    else if (arg.startsWith('--port=')) options.port = parsePort(arg.slice('--port='.length))
    else throw new Error(`无法识别的选项: ${arg}`)
  }
  if (options.all && options.agent) throw new Error('--all 与 --agent 不能同时使用')
  if (options.agent === '') throw new Error('--agent 需要提供名称')
  if (options.dryRun) options.check = false
  return options
}

function parsePort(value) {
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`端口无效: ${value}`)
  return port
}

function npxCommand(context = runtimeContext()) {
  return context.platformName === 'win32' ? 'npx.cmd' : 'npx'
}

function serverEntry(port, context = runtimeContext()) {
  const entry = {
    command: npxCommand(context),
    args: mcpArgs(),
  }
  if (port != null) entry.env = { MCP_BRIDGE_PORT: String(port) }
  return entry
}

function mcpArgs() {
  return ['-y', PACKAGE_SPEC]
}

function appDataPath(context, ...parts) {
  if (context.platformName === 'win32') return joinFor(context, context.env.APPDATA || joinFor(context, context.homeDir, 'AppData', 'Roaming'), ...parts)
  if (context.platformName === 'darwin') return joinFor(context, context.homeDir, 'Library', 'Application Support', ...parts)
  return joinFor(context, context.env.XDG_CONFIG_HOME || joinFor(context, context.homeDir, '.config'), ...parts)
}

function codeConfigPath(context) {
  return joinFor(context, context.env.CODEX_HOME || joinFor(context, context.homeDir, '.codex'), 'config.toml')
}

function targets(context = runtimeContext()) {
  const codeDir = appDataPath(context, 'Code', 'User')
  return [
    { name: 'codex', label: 'Codex', path: codeConfigPath(context), format: 'codex', alwaysKnown: true },
    { name: 'claude-code', label: 'Claude Code', path: joinFor(context, context.homeDir, '.claude.json'), format: 'json', alwaysKnown: true },
    { name: 'gemini', label: 'Gemini CLI', path: joinFor(context, context.homeDir, '.gemini', 'settings.json'), format: 'json', alwaysKnown: true },
    { name: 'cursor', label: 'Cursor', path: joinFor(context, context.homeDir, '.cursor', 'mcp.json'), format: 'json', alwaysKnown: true },
    { name: 'cline', label: 'Cline', path: joinFor(context, codeDir, 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json'), format: 'json' },
    { name: 'roo', label: 'Roo Code', path: joinFor(context, codeDir, 'globalStorage', 'rooveterinaryinc.roo-cline', 'settings', 'mcp_settings.json'), format: 'json' },
    { name: 'windsurf', label: 'Windsurf', path: joinFor(context, context.homeDir, '.codeium', 'windsurf', 'mcp_config.json'), format: 'json', alwaysKnown: true },
    { name: 'claude-desktop', label: 'Claude Desktop', path: appDataPath(context, 'Claude', 'claude_desktop_config.json'), format: 'json', alwaysKnown: true },
  ]
}

async function fileState(target) {
  try {
    const info = await stat(target.path)
    if (!info.isFile()) return { ...target, state: 'unusable', reason: '目标路径不是文件' }
    return { ...target, state: 'exists' }
  } catch (error) {
    if (error?.code === 'ENOENT') return { ...target, state: 'missing' }
    return { ...target, state: 'unreadable', reason: error.message }
  }
}

async function inspectTargets(context = runtimeContext()) {
  return Promise.all(targets(context).map(fileState))
}

function targetReport(items) {
  for (const item of items) {
    const status = item.state === 'exists' ? '已发现配置' : item.state === 'missing' ? '未发现配置（可用 --agent 主动创建）' : item.reason
    console.log(`- ${item.label}: ${status} -> ${item.path}`)
  }
}

function jsonServerEntry(existing, port, context = runtimeContext()) {
  const entry = { ...(existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {}) }
  entry.command = npxCommand(context)
  entry.args = mcpArgs()
  const env = existing?.env && typeof existing.env === 'object' && !Array.isArray(existing.env) ? { ...existing.env } : {}
  delete env.MCP_BRIDGE_TOKEN
  delete env.MCP_BRIDGE_PORT
  if (port != null) env.MCP_BRIDGE_PORT = String(port)
  if (Object.keys(env).length) entry.env = env
  else delete entry.env
  return entry
}

function jsonWithServer(text, port, context = runtimeContext()) {
  const value = text.trim() ? JSON.parse(text) : {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('JSON 配置必须是对象')
  const result = { ...value }
  const servers = result.mcpServers && typeof result.mcpServers === 'object' && !Array.isArray(result.mcpServers)
    ? { ...result.mcpServers }
    : {}
  servers[SERVER_NAME] = jsonServerEntry(servers[SERVER_NAME], port, context)
  result.mcpServers = servers
  return `${JSON.stringify(result, null, 2)}\n`
}

function tomlString(value) {
  return JSON.stringify(value)
}

function codexBlock(port, context = runtimeContext()) {
  const lines = [
    `[mcp_servers.${SERVER_NAME}]`,
    `command = ${tomlString(npxCommand(context))}`,
    `args = [${tomlString('-y')}, ${tomlString(PACKAGE_SPEC)}]`,
  ]
  if (port != null) lines.push('', `[mcp_servers.${SERVER_NAME}.env]`, `MCP_BRIDGE_PORT = ${tomlString(String(port))}`)
  return `${lines.join('\n')}\n`
}

function tableHeader(line) {
  return /^\s*\[([^\]]+)\]\s*(?:#.*)?$/.exec(line)?.[1]
}

function isTargetCodexHeader(value) {
  const normalized = value
    .replaceAll(`."${SERVER_NAME}"`, `.${SERVER_NAME}`)
    .replaceAll(`.'${SERVER_NAME}'`, `.${SERVER_NAME}`)
  return normalized === `mcp_servers.${SERVER_NAME}` || normalized.startsWith(`mcp_servers.${SERVER_NAME}.`)
}

function codexWithServer(text, port, context = runtimeContext()) {
  const lines = text ? text.replace(/\r\n/g, '\n').split('\n') : []
  const prefix = `mcp_servers.${SERVER_NAME}`
  const nestedPrefix = `${prefix}.`
  const kept = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const header = tableHeader(line)
    if (header === prefix || header?.startsWith(nestedPrefix) || (header && isTargetCodexHeader(header))) {
      index += 1
      while (index < lines.length && !tableHeader(lines[index])) index += 1
      index -= 1
      continue
    }
    kept.push(line)
  }
  while (kept.at(-1) === '') kept.pop()
  return `${kept.length ? `${kept.join('\n')}\n\n` : ''}${codexBlock(port, context)}`
}

async function readConfig(target) {
  try {
    return await readFile(target.path, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return ''
    throw error
  }
}

function backupName(path, suffix = '') {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  return `${path}.backup-${stamp}${suffix}`
}

function nextBackupName(path) {
  let suffix = ''
  let candidate = backupName(path, suffix)
  let index = 1
  while (existsSync(candidate)) {
    suffix = `-${index}`
    candidate = backupName(path, suffix)
    index += 1
  }
  return candidate
}

async function planChange(target, port, context = runtimeContext()) {
  const before = await readConfig(target)
  const after = target.format === 'codex' ? codexWithServer(before, port, context) : jsonWithServer(before, port, context)
  return { target, before, after, changed: before !== after, backup: existsSync(target.path) ? nextBackupName(target.path) : null, command: npxCommand(context), args: mcpArgs() }
}

async function applyChange(change) {
  if (!change.changed) return { ...change, applied: false }
  await mkdir(dirname(change.target.path), { recursive: true })
  if (change.backup) await copyFile(change.target.path, change.backup)
  await writeFile(change.target.path, change.after, 'utf8')
  return { ...change, applied: true }
}

function printChange(change, dryRun) {
  if (!change.changed) {
    console.log(`- ${change.target.label}: 已是最新配置，无需修改`)
    return
  }
  console.log(`- ${change.target.label}: ${dryRun ? '将更新' : '已更新'} ${change.target.path}`)
  if (change.backup) console.log(`  ${dryRun ? '将备份到' : '备份已保存到'} ${change.backup}`)
  else console.log('  原配置不存在，将创建新的配置文件')
}

function printDiff(change) {
  if (!change.changed) return
  const portConfigured = change.after.includes('MCP_BRIDGE_PORT')
  console.log('  预览内容（不回显既有配置或敏感值）：')
  console.log(`  - server: ${SERVER_NAME}`)
  console.log(`  - command: ${change.command}`)
  console.log(`  - args: ${change.args.join(' ')}`)
  if (portConfigured) console.log('  - env: MCP_BRIDGE_PORT（已配置）')
}

async function setup(options) {
  if (options.help) {
    console.log(usage())
    return 0
  }
  const items = await inspectTargets()
  console.log('检测到的 MCP 配置目标：')
  targetReport(items)

  if (options.check || (!options.agent && !options.all)) {
    console.log('\n当前为只读检测，没有修改任何文件。请使用 --agent <名称> 或 --all 明确选择安装目标。')
    return 0
  }

  const selected = options.agent
    ? items.filter((item) => item.name === options.agent)
    : items.filter((item) => item.state === 'exists')
  if (options.agent && !selected.length) throw new Error(`未知 Agent: ${options.agent}`)
  if (!selected.length) {
    console.log('\n没有已发现的配置文件可供 --all 更新；如需创建单个目标，请使用 --agent <名称>。')
    return 0
  }

  const changes = []
  for (const item of selected) {
    const change = await planChange(item, options.port)
    changes.push(change)
    printChange(change, options.dryRun)
    if (options.dryRun) printDiff(change)
  }
  if (options.dryRun) {
    console.log('\n这是预览，没有修改任何文件。')
    return 0
  }
  for (const change of changes) await applyChange(change)
  console.log('\n配置已完成。新的 MCP 进程会从本地 Bridge 的 /auth 端点自动发现连接码。')
  return 0
}

async function launchServer() {
  const serverPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'server.js')
  if (!existsSync(serverPath)) {
    throw new Error('找不到 dist/server.js。请先运行 npm run build，或使用已发布的 npx GitHub 安装方式。')
  }
  await import(pathToFileURL(serverPath).href)
}

export {
  applyChange,
  codexWithServer,
  inspectTargets,
  jsonWithServer,
  npxCommand,
  parseArgs,
  planChange,
  serverEntry,
  targets,
}

const invokedPathCandidate = process.argv[1] ? resolve(process.argv[1]) : null
const invokedPath = invokedPathCandidate && existsSync(invokedPathCandidate) ? realpathSync(invokedPathCandidate) : null
const modulePath = realpathSync(fileURLToPath(import.meta.url))

if (invokedPath === modulePath) {
  try {
    const [command, ...args] = process.argv.slice(2)
    if (command === 'setup') process.exitCode = await setup(parseArgs(args))
    else if (!command || command === 'start') await launchServer()
    else throw new Error(`未知命令: ${command}\n\n${usage()}`)
  } catch (error) {
    console.error(`安装器未能完成：${error.message}`)
    process.exitCode = 1
  }
}
