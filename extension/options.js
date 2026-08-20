import { DEFAULT_BRIDGE_URL, normalizeBridgeUrl } from './bridge-url.js'

const url = document.querySelector('#bridgeUrl')
const status = document.querySelector('#status')

chrome.storage.local.get({ bridgeUrl: DEFAULT_BRIDGE_URL }).then((values) => {
  try {
    url.value = normalizeBridgeUrl(values.bridgeUrl || DEFAULT_BRIDGE_URL)
  } catch {
    url.value = DEFAULT_BRIDGE_URL
  }
})

document.querySelector('#save').addEventListener('click', async () => {
  let bridgeUrl
  try {
    bridgeUrl = normalizeBridgeUrl(url.value)
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error)
    return
  }
  await chrome.storage.local.set({ bridgeUrl })
  await chrome.storage.session.remove('bridgeToken')
  status.textContent = '已保存，打开扩展即可自动连接'
  setTimeout(() => { status.textContent = '' }, 1500)
})
