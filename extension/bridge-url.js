export const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:8787'

export function normalizeBridgeUrl(value) {
  const raw = String(value || '').trim().replace(/\/$/, '')
  let parsed
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error('图片工具地址格式不正确')
  }
  if (parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(parsed.hostname)) {
    throw new Error('图片工具地址必须是本机的 http://127.0.0.1 或 http://localhost 地址')
  }
  if (parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username || parsed.password) {
    throw new Error('图片工具地址只能包含本机地址和端口')
  }
  return parsed.origin
}
