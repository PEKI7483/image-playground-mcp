import { DEFAULT_BRIDGE_URL, normalizeBridgeUrl } from './bridge-url.js'

const elements = {
  runTab: document.querySelector('#runTab'),
  settingsTab: document.querySelector('#settingsTab'),
  runPage: document.querySelector('#runPage'),
  settingsPage: document.querySelector('#settingsPage'),
  refresh: document.querySelector('#refresh'),
  footerRefresh: document.querySelector('#footerRefresh'),
  statusLine: document.querySelector('#statusLine'),
  statusText: document.querySelector('#statusLine span'),
  banner: document.querySelector('#banner'),
  bannerTitle: document.querySelector('#bannerTitle'),
  bannerCopy: document.querySelector('#bannerCopy'),
  bannerAction: document.querySelector('#bannerAction'),
  pageCopy: document.querySelector('#pageCopy'),
  pageValue: document.querySelector('#pageValue'),
  taskCopy: document.querySelector('#taskCopy'),
  taskValue: document.querySelector('#taskValue'),
  checkedCopy: document.querySelector('#checkedCopy'),
  checkedValue: document.querySelector('#checkedValue'),
  taskPanel: document.querySelector('#taskPanel'),
  helper: document.querySelector('#helper'),
  bridgeUrl: document.querySelector('#bridgeUrl'),
  saveSettings: document.querySelector('#saveSettings'),
  backToRun: document.querySelector('#backToRun'),
  settingsMessage: document.querySelector('#settingsMessage'),
}

let currentValues = { bridgeUrl: DEFAULT_BRIDGE_URL }

function setPage(page) {
  const settings = page === 'settings'
  elements.runPage.classList.toggle('active', !settings)
  elements.settingsPage.classList.toggle('active', settings)
  elements.runTab.classList.toggle('active', !settings)
  elements.settingsTab.classList.toggle('active', settings)
  if (settings) {
    elements.bridgeUrl.value = currentValues.bridgeUrl
    elements.settingsMessage.textContent = ''
  }
}

function setTone(tone) {
  elements.statusLine.className = `status-line ${tone}`.trim()
  elements.banner.className = `banner ${tone}`.trim()
}

function setRow(element, text, tone = '') {
  element.textContent = text
  element.className = `row-value ${tone}`.trim()
}

function setBanner(title, copy, action, actionType, tone = '') {
  elements.bannerTitle.textContent = title
  elements.bannerCopy.textContent = copy
  elements.bannerAction.textContent = action
  elements.bannerAction.dataset.action = actionType
  elements.bannerAction.hidden = !action
  setTone(tone)
}

function renderTask(task, mode) {
  if (!task) {
    elements.taskPanel.innerHTML = ''
    return
  }
  const isDone = mode === 'done'
  const progress = isDone ? 100 : 64
  const title = isDone ? '图片生成完成' : mode === 'queue' ? '你的请求正在等候' : '图片正在生成'
  const taskState = isDone ? '已完成' : mode === 'queue' ? '等候中' : '处理中'
  const copy = isDone ? '结果已出现在图片页面中，可以继续下一步。' : mode === 'queue' ? '队列会按照先来后到的顺序处理，不需要再次提交。' : '每张图片需要的时间不同，请耐心等待。不要重复提交同一个请求。'
  const left = isDone ? '完成于刚刚' : mode === 'queue' ? '前面还有请求' : '长任务会持续等待'
  const right = isDone ? '可以继续' : mode === 'queue' ? '自动处理' : '正在处理'
  elements.taskPanel.innerHTML = `<div class="task"><div class="task-head"><span class="task-title">${title}</span><span class="task-state">${taskState}</span></div><p class="task-copy">${copy}</p><div class="progress"><i style="width:${progress}%"></i></div><div class="task-foot"><span>${left}</span><span>${right}</span></div></div>`
}

function renderHealth(body) {
  const hasPlayground = Number(body.playgroundTabCount) > 0
  const activeJob = body.activeJob
  const queueLength = Number(body.queueLength ?? 0)

  if (!body.extensionConnected) {
    elements.statusText.textContent = '正在连接图片工具'
    setBanner('正在连接图片工具', '扩展正在确认浏览器里的图片页面。', '重新检查', 'refresh', 'warm')
    setRow(elements.pageValue, hasPlayground ? '已找到' : '查找中', hasPlayground ? 'good' : 'warm')
    elements.pageCopy.textContent = hasPlayground ? `${body.playgroundTabCount} 个页面已打开` : '请保持图片页面打开'
    setRow(elements.taskValue, '-', '')
    elements.taskCopy.textContent = '连接完成后会自动更新'
    renderTask(null)
    elements.helper.textContent = ''
    return
  }

  if (!hasPlayground) {
    elements.statusText.textContent = '还差一步'
    setBanner('请先打开图片页面', '打开 GPT Image Playground 的普通画廊页面后，工具就能继续工作。', '重新检查', 'refresh', 'warm')
    setRow(elements.pageValue, '未找到', 'warm')
    elements.pageCopy.textContent = '请保持普通画廊页面打开'
    setRow(elements.taskValue, '-', '')
    elements.taskCopy.textContent = '暂时不会处理新的请求'
    elements.checkedValue.textContent = '正常'
    elements.checkedCopy.textContent = '桥接服务可以访问'
    renderTask(null)
    elements.helper.textContent = ''
    return
  }

  elements.pageCopy.textContent = `${body.playgroundTabCount} 个页面已打开`
  setRow(elements.pageValue, '已就绪', 'good')
  elements.checkedValue.textContent = '正常'
  elements.checkedCopy.textContent = '刚刚完成'

  if (activeJob?.kind === 'generate_image') {
    elements.statusText.textContent = '正在处理'
    setBanner('正在生成你的图片', '每张图片需要的时间不同，请耐心等待。', '重新检查', 'refresh')
    setRow(elements.taskValue, '处理中', 'good')
    elements.taskCopy.textContent = `已等待 ${Math.max(0, Math.round((Date.now() - activeJob.claimedAt) / 1000))} 秒`
    renderTask(activeJob, 'working')
    elements.helper.textContent = '已领取的任务不会自动重复提交。'
    return
  }

  if (queueLength > 0) {
    elements.statusText.textContent = '正在排队'
    setBanner('请求已收到', `前面还有 ${queueLength} 个请求，完成后会自动处理你的图片。`, '重新检查', 'refresh', 'warm')
    setRow(elements.taskValue, '等候中', 'warm')
    elements.taskCopy.textContent = '不需要再次提交'
    renderTask({ queueLength }, 'queue')
    elements.helper.textContent = ''
    return
  }

  elements.statusText.textContent = '现在可以使用'
  setBanner('图片工具已准备好', 'Agent 可以直接帮你生成图片。', '查看连接', 'settings')
  setRow(elements.taskValue, '0 个', '')
  elements.taskCopy.textContent = '没有等待中的图片'
  renderTask(null)
  elements.helper.textContent = '图片生成时间可能不同，任务会耐心等待。'
}

function renderError(error) {
  elements.statusText.textContent = '暂时无法使用'
  setBanner('图片工具没有回应', '通常是本机图片工具还没有启动，或连接信息发生了变化。', '检查连接', 'settings', 'error')
  setRow(elements.pageValue, '-', 'error')
  elements.pageCopy.textContent = '等待连接恢复'
  setRow(elements.taskValue, '-', '')
  elements.taskCopy.textContent = '连接恢复后会自动更新'
  elements.checkedValue.textContent = '失败'
  elements.checkedCopy.textContent = error instanceof Error ? error.message : String(error)
  renderTask(null)
  elements.helper.textContent = ''
}

async function loadHealth() {
  const stored = await chrome.storage.local.get({ bridgeUrl: DEFAULT_BRIDGE_URL })
  currentValues = { bridgeUrl: normalizeBridgeUrl(stored.bridgeUrl || DEFAULT_BRIDGE_URL) }
  const authResponse = await fetch(`${currentValues.bridgeUrl}/auth`, { cache: 'no-store' })
  const authBody = await authResponse.json().catch(() => ({}))
  if (!authResponse.ok || typeof authBody.token !== 'string' || !authBody.token) throw new Error('图片工具尚未启动，请先启动 Agent 客户端')
  await chrome.storage.session.set({ bridgeToken: authBody.token })
  const response = await fetch(`${currentValues.bridgeUrl}/v1/health`, { headers: { 'X-MCP-Bridge-Token': authBody.token } })
  const body = await response.json()
  if (!response.ok) throw new Error(body.error || `连接检查失败（${response.status}）`)
  setPage('run')
  renderHealth(body)
}

async function refresh() {
  elements.refresh.disabled = true
  elements.footerRefresh.disabled = true
  elements.statusText.textContent = '正在检查'
  setBanner('正在检查图片工具', '通常只需要几秒钟。', '检查中', 'none', 'warm')
  try {
    await loadHealth()
  } catch (error) {
    renderError(error)
  } finally {
    elements.refresh.disabled = false
    elements.footerRefresh.disabled = false
  }
}

async function saveSettings() {
  let bridgeUrl
  try {
    bridgeUrl = normalizeBridgeUrl(elements.bridgeUrl.value)
  } catch (error) {
    elements.settingsMessage.textContent = error instanceof Error ? error.message : String(error)
    return
  }
  elements.saveSettings.disabled = true
  elements.settingsMessage.textContent = '已保存，正在检查连接。'
  await chrome.storage.local.set({ bridgeUrl })
  await chrome.storage.session.remove('bridgeToken')
  currentValues = { bridgeUrl }
  try {
    await loadHealth()
  } catch (error) {
    setPage('settings')
    elements.settingsMessage.textContent = error instanceof Error ? error.message : String(error)
  } finally {
    elements.saveSettings.disabled = false
  }
}

elements.runTab.addEventListener('click', () => setPage('run'))
elements.settingsTab.addEventListener('click', () => setPage('settings'))
elements.backToRun.addEventListener('click', () => setPage('run'))
elements.saveSettings.addEventListener('click', () => void saveSettings())
elements.refresh.addEventListener('click', () => void refresh())
elements.footerRefresh.addEventListener('click', () => void refresh())
elements.bannerAction.addEventListener('click', () => {
  const action = elements.bannerAction.dataset.action
  if (action === 'settings') setPage('settings')
  else if (action === 'refresh') void refresh()
})

void refresh()
