const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:8787'
const DEFAULT_BRIDGE_TOKEN = ''
let polling = false

async function settings() {
  const values = await chrome.storage.local.get({ bridgeUrl: DEFAULT_BRIDGE_URL, bridgeToken: DEFAULT_BRIDGE_TOKEN })
  return { bridgeUrl: values.bridgeUrl.replace(/\/$/, ''), bridgeToken: values.bridgeToken }
}

async function bridgeRequest(path, init = {}) {
  const config = await settings()
  if (!config.bridgeToken) throw new Error('请在扩展选项中填写 MCP_BRIDGE_TOKEN')
  const headers = { ...(init.headers || {}), 'X-MCP-Bridge-Token': config.bridgeToken }
  const response = await fetch(`${config.bridgeUrl}${path}`, { ...init, headers })
  if (response.status === 204) return null
  const body = await response.json()
  if (!response.ok) throw new Error(body.error || `桥接服务 HTTP ${response.status}`)
  return body
}

async function findPlaygroundTab() {
  const tabs = await chrome.tabs.query({})
  for (const tab of tabs) {
    if (!tab.id || !tab.url || tab.url.startsWith('chrome://')) continue
    try {
      const result = await chrome.tabs.sendMessage(tab.id, { type: 'ping' })
      if (result?.playground) return tab
    } catch {
      // 该标签页没有注入内容脚本。
    }
  }
  return null
}

async function sendHeartbeat() {
  try {
    const tabs = await chrome.tabs.query({})
    let playgroundTabs = 0
    for (const tab of tabs) {
      if (!tab.id || !tab.url || tab.url.startsWith('chrome://')) continue
      try {
        const result = await chrome.tabs.sendMessage(tab.id, { type: 'ping' })
        if (result?.playground) playgroundTabs++
      } catch {
        // 该标签页没有注入内容脚本。
      }
    }
    await bridgeRequest('/v1/heartbeat', { method: 'POST', body: JSON.stringify({ playgroundTabs }) })
  } catch {
    // 桥接服务尚未启动或令牌尚未配置，健康弹窗会显示具体状态。
  }
}

async function pollOnce() {
  const job = await bridgeRequest('/v1/next')
  if (!job) return
  const tab = await findPlaygroundTab()
  if (!tab?.id) {
    await bridgeRequest(`/v1/result/${job.id}`, {
      method: 'POST',
      body: JSON.stringify({ ok: false, error: '没有找到打开的 GPT Image Playground 页面', claimToken: job.claimToken }),
    })
    return
  }
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'job', job })
    if (!response?.accepted) throw new Error('页面没有接受任务')
  } catch (error) {
    await bridgeRequest(`/v1/result/${job.id}`, {
      method: 'POST',
      body: JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error), claimToken: job.claimToken }),
    })
  }
}

async function forwardJobHeartbeat(message) {
  await bridgeRequest(`/v1/heartbeat/${message.jobId}`, {
    method: 'POST',
    body: JSON.stringify({ claimToken: message.claimToken }),
  })
}

async function forwardJobResult(message) {
  await bridgeRequest(`/v1/result/${message.jobId}`, {
    method: 'POST',
    body: JSON.stringify({ ...message.result, claimToken: message.claimToken }),
  })
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'job-heartbeat') {
    void forwardJobHeartbeat(message)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }))
    return true
  }
  if (message?.type === 'job-result') {
    void forwardJobResult(message)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }))
    return true
  }
  return false
})

async function pollLoop() {
  if (polling) return
  polling = true
  try {
    while (true) {
      try {
        await pollOnce()
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 1_000))
      }
      await new Promise((resolve) => setTimeout(resolve, 350))
    }
  } finally {
    polling = false
  }
}

async function heartbeatLoop() {
  while (true) {
    await sendHeartbeat()
    await new Promise((resolve) => setTimeout(resolve, 3_000))
  }
}

chrome.runtime.onInstalled.addListener(() => void pollLoop())
chrome.runtime.onStartup.addListener(() => void pollLoop())
void pollLoop()
void heartbeatLoop()
