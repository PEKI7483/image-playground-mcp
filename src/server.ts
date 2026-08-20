import { readFile, stat } from 'node:fs/promises'
import { basename, extname, isAbsolute } from 'node:path'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { bridgeToken, startBridge } from './bridge.js'

const server = new Server({ name: 'gpt-image-playground', version: '0.1.0' }, { capabilities: { tools: {} } })
const bridgeBaseUrl = `http://127.0.0.1:${Number(process.env.MCP_BRIDGE_PORT ?? 8787)}`
const token = process.env.MCP_BRIDGE_TOKEN ?? bridgeToken()

const toolSchemas = {
  generate_image: z.object({
    prompt: z.string().min(1),
    reference_image_paths: z.array(z.string().min(1)).max(16).optional(),
  }),
  get_task_status: z.object({ task_id: z.string().min(1) }),
  download_image: z.object({ task_id: z.string().min(1), output_path: z.string().min(1), image_index: z.number().int().nonnegative().optional() }),
}

function getImageMimeType(filePath: string) {
  const extension = extname(filePath).toLowerCase()
  const mimeTypes: Record<string, string> = {
    '.avif': 'image/avif',
    '.gif': 'image/gif',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
  }
  const mimeType = mimeTypes[extension]
  if (!mimeType) throw new Error(`不支持的参考图格式: ${filePath}`)
  return mimeType
}

async function readReferenceImages(paths: string[] | undefined) {
  if (!paths?.length) return undefined

  const images = []
  let totalBytes = 0
  for (const filePath of paths) {
    if (!isAbsolute(filePath)) throw new Error(`参考图路径必须是绝对路径: ${filePath}`)
    const fileInfo = await stat(filePath)
    if (!fileInfo.isFile()) throw new Error(`参考图不是普通文件: ${filePath}`)
    if (fileInfo.size > 8 * 1024 * 1024) throw new Error(`单张参考图不能超过 8 MiB: ${filePath}`)
    totalBytes += fileInfo.size
    if (totalBytes > 24 * 1024 * 1024) throw new Error('参考图总大小不能超过 24 MiB')
    images.push({
      name: basename(filePath),
      mimeType: getImageMimeType(filePath),
      base64: (await readFile(filePath)).toString('base64'),
    })
  }
  return images
}

async function bridgeFetch(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  headers.set('X-MCP-Bridge-Token', token)
  if (init.body) headers.set('Content-Type', 'application/json')
  const response = await fetch(`${bridgeBaseUrl}${path}`, { ...init, headers })
  const text = await response.text()
  const body = text ? JSON.parse(text) as Record<string, unknown> : {}
  if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : `桥接服务返回 HTTP ${response.status}`)
  return body
}

function textResult(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] }
}

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'generate_image',
      description: '通过已打开的 GPT Image Playground 页面生成图片，可先注入本地参考图。请求会被浏览器桥接扩展串行处理，直到页面报告完成或失败；没有 20 秒固定上限。',
      inputSchema: {
        type: 'object',
        properties: {
          prompt: { type: 'string' },
          reference_image_paths: { type: 'array', items: { type: 'string' }, maxItems: 16 },
        },
        required: ['prompt'],
      },
    },
    {
      name: 'get_task_status',
      description: '查询 Playground 页面中某个生成任务的状态。',
      inputSchema: { type: 'object', properties: { task_id: { type: 'string' } }, required: ['task_id'] },
    },
    {
      name: 'download_image',
      description: '把已完成任务中的图片从 Playground 页面保存到 MCP 主机的本地绝对路径。',
      inputSchema: { type: 'object', properties: { task_id: { type: 'string' }, output_path: { type: 'string' }, image_index: { type: 'number' } }, required: ['task_id', 'output_path'] },
    },
  ],
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name
  const args = request.params.arguments ?? {}

  if (name === 'generate_image') {
    const input = toolSchemas.generate_image.parse(args)
    const referenceImages = await readReferenceImages(input.reference_image_paths)
    return textResult(await bridgeFetch('/v1/generate', {
      method: 'POST',
      body: JSON.stringify({ prompt: input.prompt, referenceImages }),
    }))
  }

  if (name === 'get_task_status') {
    const input = toolSchemas.get_task_status.parse(args)
    return textResult(await bridgeFetch('/v1/status', { method: 'POST', body: JSON.stringify({ taskId: input.task_id }) }))
  }

  if (name === 'download_image') {
    const input = toolSchemas.download_image.parse(args)
    const result = await bridgeFetch('/v1/download', { method: 'POST', body: JSON.stringify({ taskId: input.task_id, outputPath: input.output_path, imageIndex: input.image_index }) })
    return textResult({ ...result, file_name: basename(input.output_path) })
  }

  throw new Error(`未知工具: ${name}`)
})

startBridge()
await server.connect(new StdioServerTransport())
