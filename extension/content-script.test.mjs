import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const source = fs.readFileSync(new URL('./content-script.js', import.meta.url), 'utf8')

class Element {
  constructor(attributes = {}) {
    this.attributes = { ...attributes }
    this.listeners = new Map()
    this.visible = true
  }

  getAttribute(name) {
    return this.attributes[name] ?? null
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener)
  }

  removeEventListener(type) {
    this.listeners.delete(type)
  }

  dispatchEvent(event) {
    this.listeners.get(event.type)?.()
    return true
  }

  getClientRects() {
    return this.visible ? [{}] : []
  }
}

class HTMLElement extends Element {}
class HTMLImageElement extends HTMLElement {
  constructor({ id = null, src, visible = true, loaded = true }) {
    super(id ? { 'data-image-id': id } : {})
    this.src = src
    this.currentSrc = src
    this.visible = visible
    this.complete = loaded
    this.naturalWidth = loaded ? 1024 : 0
  }

  load() {
    this.complete = true
    this.naturalWidth = 1024
    this.dispatchEvent({ type: 'load' })
  }
}
class HTMLButtonElement extends HTMLElement {
  constructor(attributes = {}, onClick = () => {}) {
    super(attributes)
    this.onClick = onClick
    this.clickCount = 0
  }

  click() {
    this.clickCount++
    this.onClick()
  }

  querySelector() {
    return null
  }
}
class HTMLInputElement extends HTMLElement {}

function createHarness(images, { outputIds = [], onNext = () => {} } = {}) {
  const close = new HTMLButtonElement({ 'aria-label': '关闭' })
  const next = new HTMLButtonElement({ 'aria-label': '下一张' }, onNext)
  const modal = new HTMLElement()
  modal.querySelectorAll = (selector) => selector === 'img' ? images : selector === 'button' ? [next, close] : []
  modal.querySelector = (selector) => selector === 'img' ? images[0] : null

  const card = new HTMLElement()
  card.click = () => {}
  card.querySelector = (selector) => selector === '[data-output-image-ids]'
    ? new HTMLElement({ 'data-output-image-ids': outputIds.join(',') })
    : null

  const document = {
    querySelector: (selector) => selector.includes('[data-no-drag-select]') ? modal : null,
    querySelectorAll: () => [],
  }
  const context = vm.createContext({
    console,
    document,
    chrome: { runtime: { onMessage: { addListener() {} } } },
    CSS: { escape: String },
    Element,
    HTMLElement,
    HTMLImageElement,
    HTMLButtonElement,
    HTMLInputElement,
    InputEvent: class {},
    KeyboardEvent: class { constructor(type, options) { this.type = type; Object.assign(this, options) } },
    Event: class { constructor(type) { this.type = type } },
    DataTransfer: class {},
    File: class {},
    Uint8Array,
    setInterval,
    clearInterval,
    setTimeout,
    getComputedStyle: (element) => ({ visibility: element.visible ? 'visible' : 'hidden', display: element.visible ? 'block' : 'none' }),
  })
  vm.runInContext(source, context)
  return { context, card, close, next }
}

{
  const first = new HTMLImageElement({ id: 'first', src: 'blob:first', visible: true })
  const target = new HTMLImageElement({ id: 'target', src: 'blob:target', visible: false })
  const { context, card, next } = createHarness([first, target], { outputIds: ['first', 'target'] })
  const result = await vm.runInContext('openOriginalImage', context)(card, 1)
  assert.equal(result, target, 'an exact target ID should be returned')
  assert.equal(next.clickCount, 0, 'an exact target ID must not trigger next navigation')
}

{
  const first = new HTMLImageElement({ src: 'blob:first', visible: true })
  const second = new HTMLImageElement({ src: 'blob:second', visible: false })
  const harness = createHarness([first, second], {
    onNext: () => {
      first.visible = false
      second.visible = true
    },
  })
  const result = await vm.runInContext('openOriginalImage', harness.context)(harness.card, 1)
  assert.equal(result, second, 'index fallback should return the newly displayed image')
  assert.equal(harness.next.clickCount, 1, 'index fallback should navigate exactly once')
}

{
  const first = new HTMLImageElement({ id: 'first', src: 'blob:first', visible: true })
  const second = new HTMLImageElement({ id: 'second', src: 'blob:second', visible: true })
  const harness = createHarness([first, second], {
    outputIds: [],
    onNext: () => { second.attributes['data-image-id'] = 'second-after-next' },
  })
  const result = await vm.runInContext('waitForDetailImage', harness.context)(null, 500, {
    visibleOnly: true,
    previousIdentity: 'first\nblob:first',
  })
  assert.equal(result, second, 'fallback should choose a visible image whose identity changed')
}

{
  const image = new HTMLImageElement({ src: 'blob:async', loaded: false })
  const { context } = createHarness([image])
  setTimeout(() => image.load(), 10)
  const result = await vm.runInContext('waitForDetailImage', context)(null, 500)
  assert.equal(result, image, 'waitForDetailImage should wait for a real load event')
}

{
  const image = new HTMLImageElement({ src: 'blob:close' })
  const harness = createHarness([image])
  harness.context.fetch = async () => { throw new Error('download failed') }
  await assert.rejects(vm.runInContext('imageData', harness.context)(harness.card, 0), /download failed/)
  assert.equal(harness.close.clickCount, 1, 'the modal should close when download fails')
}

assert.equal((source.match(/async function waitForDetailImage\s*\(/g) || []).length, 1, 'waitForDetailImage must be defined once')
assert.doesNotMatch(source, /timeoutMs\s*=\s*10_000/, 'the old 10 second detail timeout must not return')

console.log('content-script DOM simulation tests passed')
