const SELECTORS = {
  input: '[data-input-bar] [contenteditable][aria-label*="描述你想生成的图片"], [data-input-bar] [contenteditable][aria-label]',
  submit: '[data-input-bar] button[aria-label="生成图像"]',
  cards: '.task-card-wrapper[data-task-id]',
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let activeJobId = null

function isPlayground() {
  return Boolean(document.querySelector(SELECTORS.input) && document.querySelector('[data-input-bar]'))
}

function cardSnapshot() {
  const result = new Map()
  document.querySelectorAll(SELECTORS.cards).forEach((card) => {
    const taskId = card.getAttribute('data-task-id')
    if (!taskId) return
    result.set(taskId, {
      taskId,
      done: Boolean(card.querySelector('img[data-image-id]')) && !card.querySelector('.generating'),
      failed: [...card.querySelectorAll('span')].some((span) => span.textContent?.trim() === '失败'),
      outputImageIds: (card.querySelector('[data-output-image-ids]')?.getAttribute('data-output-image-ids') || '').split(',').filter(Boolean),
    })
  })
  return result
}

function fillPrompt(prompt) {
  const input = document.querySelector(SELECTORS.input)
  if (!(input instanceof HTMLElement)) throw new Error('没有找到 Playground 输入框')
  input.focus()
  document.execCommand('selectAll')
  document.execCommand('insertText', false, prompt)
  input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: prompt }))
}

function decodeBase64(base64) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

async function attachReferenceImages(images) {
  if (!images?.length) return
  const input = document.querySelector('[data-input-bar] input[type="file"][multiple]')
  if (!(input instanceof HTMLInputElement)) throw new Error('没有找到 Playground 参考图文件输入框')

  const transfer = new DataTransfer()
  for (const image of images) {
    transfer.items.add(new File([decodeBase64(image.base64)], image.name, { type: image.mimeType }))
  }
  input.files = transfer.files
  input.dispatchEvent(new Event('change', { bubbles: true }))

  // 页面原有 onChange 会异步压缩和保存图片，并在完成后清空 input.value。
  const startedAt = Date.now()
  while (input.files?.length && Date.now() - startedAt < 20_000) await sleep(200)
  if (input.files?.length) throw new Error('Playground 未完成参考图上传，已取消本次生成')
  await sleep(500)
}

async function waitForNewCard(previous, timeoutMs) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const current = cardSnapshot()
    for (const [taskId, state] of current) {
      if (!previous.has(taskId)) return state
    }
    await sleep(300)
  }
  throw new Error('提交后没有发现新的任务卡片')
}

async function waitForCompletion(taskId) {
  while (true) {
    const card = document.querySelector(`.task-card-wrapper[data-task-id="${CSS.escape(taskId)}"]`)
    if (!card) throw new Error('任务卡片已从当前页面移除')
    const imageIds = (card.querySelector('[data-output-image-ids]')?.getAttribute('data-output-image-ids') || '').split(',').filter(Boolean)
    if (card.querySelector('.generating')) {
      await sleep(500)
      continue
    }
    if (imageIds.length || card.querySelector('img[data-image-id]')) {
      return { ok: true, taskId, status: 'done', outputImageIds: imageIds }
    }
    if ([...card.querySelectorAll('span')].some((span) => span.textContent?.trim() === '失败')) {
      return { ok: false, taskId, status: 'error', outputImageIds: [], error: '页面任务生成失败' }
    }
    await sleep(500)
  }
}

async function generate(job) {
  await attachReferenceImages(job.payload.referenceImages)
  const previous = cardSnapshot()
  fillPrompt(job.payload.prompt)
  const submit = document.querySelector(SELECTORS.submit)
  if (!(submit instanceof HTMLButtonElement)) throw new Error('没有找到“生成图像”按钮，请确认当前为普通画廊模式')
  if (submit.disabled) throw new Error('生成按钮当前不可用')
  submit.click()
  const created = await waitForNewCard(previous, 15_000)
  return waitForCompletion(created.taskId)
}

function findTaskCard(taskId) {
  const card = document.querySelector(`.task-card-wrapper[data-task-id="${CSS.escape(taskId)}"]`)
  if (!(card instanceof HTMLElement)) throw new Error('没有找到任务卡片')
  return card
}

function findDetailModal() {
  const direct = document.querySelector('[data-no-drag-select].fixed, [role="dialog"][aria-modal="true"]')
  if (direct instanceof HTMLElement) return direct
  return [...document.querySelectorAll('.fixed')].reverse().find((element) => element.querySelector('img')) || null
}

function findDetailImages(modal) {
  return [...modal.querySelectorAll('img')].filter((image) => image instanceof HTMLImageElement)
}

function isDisplayedImage(image) {
  return image instanceof HTMLImageElement && image.getClientRects().length > 0 &&
    getComputedStyle(image).visibility !== 'hidden' && getComputedStyle(image).display !== 'none'
}

function displayedDetailImage(images) {
  return images.find((image) => isDisplayedImage(image) && (image.currentSrc || image.src)) || null
}

function detailImageIdentity(image) {
  return `${image.getAttribute('data-image-id') || ''}\n${image.currentSrc || image.src || ''}`
}

async function waitForDetailImage(imageId, timeoutMs = 60_000, { visibleOnly = false, previousIdentity = null } = {}) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const modal = findDetailModal()
    if (modal instanceof HTMLElement) {
      const images = findDetailImages(modal)
      const exact = imageId ? images.find((image) =>
        image.getAttribute('data-image-id') === imageId && (!visibleOnly || isDisplayedImage(image)),
      ) : null
      const image = exact || (previousIdentity === null
        ? displayedDetailImage(images)
        : images.find((candidate) => isDisplayedImage(candidate) &&
          (candidate.currentSrc || candidate.src) && detailImageIdentity(candidate) !== previousIdentity))
      if (image instanceof HTMLImageElement && (image.currentSrc || image.src) &&
        (previousIdentity === null || detailImageIdentity(image) !== previousIdentity)) {
        if (image.complete && image.naturalWidth > 0) return image
        await new Promise((resolve) => {
          const finish = () => {
            image.removeEventListener('load', finish)
            image.removeEventListener('error', finish)
            resolve()
          }
          image.addEventListener('load', finish, { once: true })
          image.addEventListener('error', finish, { once: true })
          setTimeout(finish, 500)
        })
        if (image.complete && image.naturalWidth > 0) return image
      }
    }
    await sleep(200)
  }
  throw new Error('任务详情中的原图加载超时（已等待 60 秒）')
}

function findDetailNextButton() {
  const modal = findDetailModal()
  if (!(modal instanceof HTMLElement)) return null
  return [...modal.querySelectorAll('button')].find((button) =>
    button.querySelector('path[d="M9 5l7 7-7 7"]') ||
    /下一张|next/i.test(button.getAttribute('aria-label') || button.getAttribute('title') || ''),
  ) || null
}

async function openOriginalImage(card, imageIndex) {
  const outputIds = (card.querySelector('[data-output-image-ids]')?.getAttribute('data-output-image-ids') || '').split(',').filter(Boolean)
  const targetIndex = imageIndex || 0
  const targetId = outputIds[targetIndex]
  card.click()
  let image = await waitForDetailImage(targetId)

  // The requested full-size image may already be present in the modal, even if other images are hidden.
  if (image.getAttribute('data-image-id') === targetId || targetIndex === 0) return image

  // Without a matching image ID, navigate from the modal's currently displayed first image.
  for (let index = 0; index < targetIndex; index++) {
    const next = findDetailNextButton()
    if (!(next instanceof HTMLButtonElement)) throw new Error('无法切换到指定输出图片')
    const previousIdentity = detailImageIdentity(image)
    next.click()
    image = await waitForDetailImage(outputIds[index + 1], 60_000, { visibleOnly: true, previousIdentity })
  }
  return image
}

function closeDetailModal() {
  const modal = findDetailModal()
  if (!(modal instanceof HTMLElement)) return
  const close = [...modal.querySelectorAll('button')].find((button) =>
    /^(关闭|close)$/i.test(button.getAttribute('aria-label') || button.getAttribute('title') || ''),
  )
  if (close instanceof HTMLButtonElement) {
    close.click()
    return
  }
  modal.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))
}

async function imageData(card, imageIndex) {
  try {
    const image = await openOriginalImage(card, imageIndex)
    if (!(image instanceof HTMLImageElement)) throw new Error('任务没有可下载的图片，请先等待生成完成')
    const imageUrl = image.currentSrc || image.src
    if (!imageUrl) throw new Error('图片尚未加载，请稍后重试')
    const response = await fetch(imageUrl)
    if (!response.ok) throw new Error(`读取页面图片失败: HTTP ${response.status}`)
    const blob = await response.blob()
    const buffer = await blob.arrayBuffer()
    let binary = ''
    const bytes = new Uint8Array(buffer)
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return { base64: btoa(binary), mimeType: blob.type || 'image/png' }
  } finally {
    closeDetailModal()
  }
}

async function handleJob(job) {
  if (!isPlayground()) return { ok: false, error: '当前标签页不是 GPT Image Playground' }
  if (job.kind === 'generate_image') return generate(job)
  if (job.kind === 'get_task_status') {
    const card = findTaskCard(job.payload.taskId)
    const snapshot = cardSnapshot().get(job.payload.taskId)
    return { ok: true, ...(snapshot || { taskId: job.payload.taskId, status: 'running', outputImageIds: [] }) }
  }
  if (job.kind === 'download_image') {
    const card = findTaskCard(job.payload.taskId)
    const image = await imageData(card, job.payload.imageIndex)
    return { ok: true, taskId: job.payload.taskId, image }
  }
  return { ok: false, error: `未知任务类型: ${job.kind}` }
}

async function sendJobMessage(message) {
  while (true) {
    try {
      const response = await chrome.runtime.sendMessage(message)
      if (response?.ok) return
    } catch {
      // Service Worker 休眠或桥接暂时不可用时，下一轮继续发送。
    }
    await sleep(1_000)
  }
}

function startJob(job) {
  if (activeJobId) return
  activeJobId = job.id
  void (async () => {
    let heartbeatInFlight = false
    const heartbeatTimer = setInterval(() => {
      if (heartbeatInFlight) return
      heartbeatInFlight = true
      void sendJobMessage({ type: 'job-heartbeat', jobId: job.id, claimToken: job.claimToken })
        .finally(() => { heartbeatInFlight = false })
    }, job.heartbeatIntervalMs || 5_000)
    let result
    try {
      result = await handleJob(job)
    } catch (error) {
      result = { ok: false, error: error instanceof Error ? error.message : String(error) }
    } finally {
      clearInterval(heartbeatTimer)
    }
    await sendJobMessage({ type: 'job-result', jobId: job.id, claimToken: job.claimToken, result })
    activeJobId = null
  })()
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'ping') {
    sendResponse({ playground: isPlayground() })
    return false
  }
  if (message?.type !== 'job') return false
  if (activeJobId) {
    sendResponse({ accepted: false, error: '当前标签页已有任务执行中' })
    return false
  }
  startJob(message.job)
  sendResponse({ accepted: true })
  return false
})
