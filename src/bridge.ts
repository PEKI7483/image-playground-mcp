import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { dirname, isAbsolute } from 'node:path'
import type { BridgeHealth, BridgeJob, BridgeRequestKind, BridgeResult, BridgeTaskStatus, ReferenceImage } from './protocol.js'

const port = Number(process.env.MCP_BRIDGE_PORT ?? 8787)
const configuredToken = process.env.MCP_BRIDGE_TOKEN?.trim()
const token = configuredToken || randomBytes(24).toString('hex')
const heartbeatIntervalMs = 5_000
const configuredStaleMs = Number(process.env.MCP_ACTIVE_STALE_MS ?? 0)

interface PendingJob {
  job: BridgeJob
  resolve: (result: BridgeResult) => void
  timer?: NodeJS.Timeout
  phase: 'queued' | 'claimed'
  claimToken?: string
  claimedAt?: number
  lastHeartbeatAt?: number
  callerTimedOut: boolean
}

const queue: PendingJob[] = []
const pending = new Map<string, PendingJob>()
const tasks = new Map<string, BridgeTaskStatus>()
const completedResults = new Map<string, { claimToken: string; result: BridgeResult; completedAt: number }>()
let activeJob: PendingJob | null = null
let extensionLastSeen = 0
let playgroundTabCount = 0

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.from(chunk))
  if (!chunks.length) return {}
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('请求体必须是 JSON 对象')
  return value as Record<string, unknown>
}

function authorized(req: IncomingMessage) {
  return req.headers['x-mcp-bridge-token'] === token
}

function stringField(body: Record<string, unknown>, name: string) {
  const value = body[name]
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} 必须是非空字符串`)
  return value.trim()
}

function parseReferenceImages(value: unknown): ReferenceImage[] | undefined {
  if (value == null) return undefined
  if (!Array.isArray(value) || value.length > 16) throw new Error('参考图数量必须在 1 到 16 张之间')

  let totalBase64Length = 0
  const images = value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`参考图 ${index + 1} 数据无效`)
    const candidate = item as Record<string, unknown>
    if (typeof candidate.name !== 'string' || !candidate.name.trim()) throw new Error(`参考图 ${index + 1} 缺少文件名`)
    if (typeof candidate.mimeType !== 'string' || !candidate.mimeType.startsWith('image/')) throw new Error(`参考图 ${index + 1} MIME 类型无效`)
    if (typeof candidate.base64 !== 'string' || !candidate.base64) throw new Error(`参考图 ${index + 1} 数据为空`)
    if (candidate.base64.length > 12 * 1024 * 1024) throw new Error(`参考图 ${index + 1} 数据过大`)
    totalBase64Length += candidate.base64.length
    if (totalBase64Length > 36 * 1024 * 1024) throw new Error('参考图总数据过大')
    return {
      name: candidate.name,
      mimeType: candidate.mimeType,
      base64: candidate.base64,
    }
  })
  return images
}

function removeFromQueue(item: PendingJob) {
  const index = queue.indexOf(item)
  if (index >= 0) queue.splice(index, 1)
}

function addJob(kind: BridgeRequestKind, payload: BridgeJob['payload'], timeoutMs?: number) {
  const id = randomUUID()
  const job: BridgeJob = { id, kind, payload, createdAt: Date.now() }
  const promise = new Promise<BridgeResult>((resolve) => {
    const item: PendingJob = { job, resolve, phase: 'queued', callerTimedOut: false }
    pending.set(id, item)
    queue.push(item)

    if (timeoutMs && timeoutMs > 0) {
      item.timer = setTimeout(() => {
        if (item.phase === 'queued') {
          removeFromQueue(item)
          pending.delete(id)
          resolve({ ok: false, error: '任务在等待浏览器时超时，未执行生成' })
          return
        }

        // 领取后的任务不能重排，否则可能造成重复点击和并发生成。
        item.callerTimedOut = true
        resolve({ ok: false, error: '调用方等待超时；浏览器任务仍在执行，不会自动重试' })
      }, timeoutMs)
    }
  })
  return promise
}

function abandonStaleActiveJob() {
  if (!activeJob || !configuredStaleMs || !activeJob.lastHeartbeatAt) return
  if (Date.now() - activeJob.lastHeartbeatAt <= configuredStaleMs) return

  const item = activeJob
  activeJob = null
  pending.delete(item.job.id)
  if (item.timer) clearTimeout(item.timer)
  if (!item.callerTimedOut) item.resolve({ ok: false, error: '扩展长时间失联，任务已停止等待；原任务不会自动重试' })
}

function claimNextJob() {
  abandonStaleActiveJob()
  if (activeJob) return null
  const item = queue.shift()
  if (!item) return null

  item.phase = 'claimed'
  item.claimToken = randomUUID()
  item.claimedAt = Date.now()
  item.lastHeartbeatAt = item.claimedAt
  item.job.claimToken = item.claimToken
  item.job.heartbeatIntervalMs = heartbeatIntervalMs
  activeJob = item
  return item.job
}

function getClaimedJob(id: string, claimToken: unknown) {
  if (!activeJob || activeJob.job.id !== id) throw new Error('任务不是当前执行中的任务')
  if (typeof claimToken !== 'string' || claimToken !== activeJob.claimToken) throw new Error('任务领取令牌无效')
  return activeJob
}

function bridgeTaskFromResult(taskId: string, result: BridgeResult) {
  const now = Date.now()
  const current = tasks.get(taskId) ?? {
    taskId,
    status: result.ok ? 'done' : 'error',
    outputImageIds: [],
    createdAt: now,
    updatedAt: now,
  }
  current.status = result.ok ? 'done' : 'error'
  current.updatedAt = now
  if (result.outputImageIds) current.outputImageIds = result.outputImageIds
  if (result.error) current.error = result.error
  tasks.set(taskId, current)
}

async function saveImageResult(job: PendingJob, result: BridgeResult) {
  if (job.job.kind !== 'download_image' || !result.ok) return result
  if (!result.image?.base64) throw new Error('扩展没有返回图片数据')
  const payload = job.job.payload
  if (!('outputPath' in payload)) throw new Error('下载任务参数无效')
  const bytes = Buffer.from(result.image.base64, 'base64')
  if (!bytes.length) throw new Error('图片数据为空')
  await mkdir(dirname(payload.outputPath), { recursive: true })
  await writeFile(payload.outputPath, bytes, { flag: 'wx' }).catch(async (error: unknown) => {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    const existing = await readFile(payload.outputPath)
    if (!existing.equals(bytes)) throw new Error(`目标文件已存在且内容不同: ${payload.outputPath}`)
  })
  return {
    ...result,
    image: undefined,
    path: payload.outputPath,
    bytes: bytes.byteLength,
    mimeType: result.image.mimeType,
  }
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)

  try {
    if (req.method === 'GET' && url.pathname === '/auth') {
      return json(res, 200, { ok: true, token, port })
    }

    if (!authorized(req)) return json(res, 401, { error: '未授权的桥接请求' })

    if (req.method === 'GET' && url.pathname === '/v1/next') {
      extensionLastSeen = Date.now()
      const job = claimNextJob()
      if (!job) return json(res, 204, null)
      return json(res, 200, job)
    }

    if (req.method === 'POST' && (url.pathname.startsWith('/v1/heartbeat/') || url.pathname.startsWith('/v1/lease/'))) {
      extensionLastSeen = Date.now()
      const prefix = url.pathname.startsWith('/v1/heartbeat/') ? '/v1/heartbeat/' : '/v1/lease/'
      const id = url.pathname.slice(prefix.length)
      const body = await readJson(req)
      const item = getClaimedJob(id, body.claimToken)
      item.lastHeartbeatAt = Date.now()
      return json(res, 200, { ok: true, nextHeartbeatMs: heartbeatIntervalMs })
    }

    if (req.method === 'POST' && url.pathname.startsWith('/v1/result/')) {
      const id = url.pathname.slice('/v1/result/'.length)
      const item = pending.get(id)
      const body = await readJson(req)
      if (!item) {
        const completed = completedResults.get(id)
        if (completed && completed.claimToken === body.claimToken) return json(res, 200, { ok: true, duplicate: true })
        return json(res, 404, { error: '任务不存在或已过期' })
      }
      let result = body as unknown as BridgeResult
      if (typeof result.ok !== 'boolean') throw new Error('result.ok 无效')
      getClaimedJob(id, body.claimToken)
      result = await saveImageResult(item, result)
      if (item.timer) clearTimeout(item.timer)
      pending.delete(id)
      activeJob = null
      if (result.taskId) bridgeTaskFromResult(result.taskId, result)
      completedResults.set(id, { claimToken: item.claimToken!, result, completedAt: Date.now() })
      if (!item.callerTimedOut) item.resolve(result)
      return json(res, 200, { ok: true })
    }

    if (req.method === 'POST' && url.pathname === '/v1/generate') {
      const body = await readJson(req)
      const prompt = stringField(body, 'prompt')
      const referenceImages = parseReferenceImages(body.referenceImages)
      const result = await addJob('generate_image', { prompt, referenceImages })
      return json(res, 200, result)
    }

    if (req.method === 'GET' && url.pathname.startsWith('/v1/tasks/')) {
      const taskId = url.pathname.slice('/v1/tasks/'.length)
      const task = tasks.get(taskId)
      return task ? json(res, 200, task) : json(res, 404, { error: '任务不存在' })
    }

    if (req.method === 'POST' && url.pathname === '/v1/status') {
      const body = await readJson(req)
      const taskId = stringField(body, 'taskId')
      const result = await addJob('get_task_status', { taskId }, 60_000)
      return json(res, 200, result)
    }

    if (req.method === 'POST' && url.pathname === '/v1/download') {
      const body = await readJson(req)
      const taskId = stringField(body, 'taskId')
      const outputPath = stringField(body, 'outputPath')
      if (!isAbsolute(outputPath)) throw new Error('outputPath 必须是绝对路径')
      const imageIndex = body.imageIndex == null ? undefined : Number(body.imageIndex)
      const result = await addJob('download_image', { taskId, outputPath, imageIndex }, 10 * 60_000)
      return json(res, 200, result)
    }

    if (req.method === 'POST' && url.pathname === '/v1/heartbeat') {
      const body = await readJson(req)
      extensionLastSeen = Date.now()
      if (typeof body.playgroundTabs === 'number') playgroundTabCount = Math.max(0, Math.trunc(body.playgroundTabs))
      return json(res, 200, { ok: true })
    }

    if (req.method === 'GET' && url.pathname === '/v1/health') {
      const health: BridgeHealth = {
        ok: true,
        bridge: 'running',
        extensionConnected: Date.now() - extensionLastSeen < 10_000,
        extensionLastSeen: extensionLastSeen || null,
        playgroundTabCount,
        queueLength: queue.length,
        activeJobs: activeJob ? 1 : 0,
        pendingJobs: pending.size,
      }
      if (activeJob?.claimedAt && activeJob.lastHeartbeatAt) {
        const now = Date.now()
        health.activeJob = {
          id: activeJob.job.id,
          kind: activeJob.job.kind,
          claimedAt: activeJob.claimedAt,
          lastHeartbeatAt: activeJob.lastHeartbeatAt,
          heartbeatAgeMs: now - activeJob.lastHeartbeatAt,
          callerTimedOut: activeJob.callerTimedOut,
          stale: now - activeJob.lastHeartbeatAt > heartbeatIntervalMs * 3,
        }
      }
      return json(res, 200, health)
    }

    return json(res, 404, { error: '未知桥接路径' })
  } catch (error) {
    return json(res, 400, { error: error instanceof Error ? error.message : String(error) })
  }
}

export function startBridge() {
  let server: ReturnType<typeof createServer> | undefined

  server = createServer((req, res) => {
    void handle(req, res)
  })
  server.once('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`MCP browser bridge port 127.0.0.1:${port} is already in use; using the existing bridge`)
      server?.close()
      return
    }
    console.error(error)
  })
  server.listen(port, '127.0.0.1', () => {
    console.error(`MCP browser bridge listening on 127.0.0.1:${port}`)
  })
  return server
}
