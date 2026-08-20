const url = document.querySelector('#bridgeUrl')
const token = document.querySelector('#bridgeToken')
const status = document.querySelector('#status')

chrome.storage.local.get({ bridgeUrl: 'http://127.0.0.1:8787', bridgeToken: '' }).then((values) => {
  url.value = values.bridgeUrl
  token.value = values.bridgeToken
})

document.querySelector('#save').addEventListener('click', async () => {
  await chrome.storage.local.set({ bridgeUrl: url.value.trim().replace(/\/$/, ''), bridgeToken: token.value.trim() })
  status.textContent = '已保存'
  setTimeout(() => { status.textContent = '' }, 1500)
})
