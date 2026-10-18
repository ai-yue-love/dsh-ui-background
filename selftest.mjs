/**
 * Host-half self test: mounts the plugin with a fake Cordis context and calls
 * its own HTTP handlers, so the workshop scan is verified against this machine
 * instead of being assumed to work.
 *
 * Usage: node selftest.mjs
 */
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const modulePath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.js')
const plugin = await import(pathToFileURL(modulePath).href)

const routes = new Map()
const fakeCtx = {
  logger: { warn: () => undefined },
  effect: (fn) => {
    const disposer = fn()
    return typeof disposer === 'function' ? disposer : () => undefined
  },
  webServer: {
    register: (route) => {
      routes.set(route.path, route.handler)
      return () => routes.delete(route.path)
    },
  },
}

plugin.apply(fakeCtx)
console.log('routes:', [...routes.keys()].join(', '))

function call(target) {
  const pathname = target.split('?')[0]
  return new Promise((resolve, reject) => {
    const chunks = []
    const res = {
      status: 0,
      headers: {},
      writeHead(status, headers) {
        this.status = status
        this.headers = headers ?? {}
      },
      end(body) {
        if (body !== undefined) chunks.push(Buffer.isBuffer(body) ? body : Buffer.from(String(body)))
        resolve({ status: this.status, headers: this.headers, body: Buffer.concat(chunks).toString('utf8') })
      },
      write(chunk) {
        chunks.push(Buffer.from(chunk))
      },
      destroy() {
        reject(new Error('response destroyed'))
      },
    }
    const handler = routes.get(pathname)
    if (handler === undefined) {
      reject(new Error(`no route ${pathname}`))
      return
    }
    void handler({ method: 'GET', url: target, headers: {} }, res)
  })
}

const workshop = await call('/dsh-ui-background/workshop')
console.log('workshop status:', workshop.status)
const payload = JSON.parse(workshop.body)
console.log('steam roots:', JSON.stringify(payload.roots))
console.log('items:', payload.items.length)
for (const item of payload.items) {
  console.log(` - [${item.kind}] ${item.title}`)
  console.log(`     media:  ${item.media ?? '(none)'}`)
  console.log(`     poster: ${item.poster ?? '(none)'}`)
}

const first = payload.items.find((item) => item.hasPoster)
if (first !== undefined) {
  const poster = await call(`/dsh-ui-background/workshop-poster?id=${first.id}`)
  console.log(`poster(${first.id}) status=${poster.status} type=${poster.headers['content-type']} bytes=${poster.body.length}`)
} else {
  console.log('poster: no item has one')
}

const missing = await call('/dsh-ui-background/thumb?key=does-not-exist')
console.log(`thumb(missing key) status=${missing.status} body=${missing.body.slice(0, 40)}`)