/**
 * Host half of the local background plugin (v0.2).
 *
 * Responsibilities:
 * - keep the user's background preference in `$DSH_HOME/storages/dsh-ui-background/state.json`
 * - store uploaded background files beside it (`backgrounds/`)
 * - serve the current background (with HTTP Range) and serve/accept state over loopback routes
 *
 * The visual work (glass panels) happens entirely in the Client half through
 * theme token overrides; nothing here touches the page markup.
 */
import { createReadStream, createWriteStream, promises as fsp } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const name = '@dsh-local/dsh-ui-background'

/** The browser HTTP carrier owns the routes this plugin claims. */
export const inject = ['webServer']

const BASE = '/dsh-ui-background'
const STORE_ID = 'dsh-ui-background'
const MAX_UPLOAD_BYTES = 64 * 1024 * 1024
const MAX_JSON_BYTES = 32 * 1024

const IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.bmp']
const VIDEO_EXT = ['.mp4', '.webm', '.mkv', '.mov']

const MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
}

/** Values a fresh install starts from; the Client mirrors this shape. */
const DEFAULT_STATE = {
  enabled: false,
  source: 'upload',
  file: '',
  path: '',
  /** `cover` fills the viewport (crops), `contain` shows the whole picture. */
  fit: 'cover',
  /** Percent of the fitted size; 100 = exactly fitted. */
  zoom: 100,
  /** Background anchor, 0..100 on each axis (50 = centered). */
  posX: 50,
  posY: 50,
  /** In `contain` mode, fill the letterbox with a blurred copy of the media. */
  fill: true,
  opacity: 72,
  blur: 24,
  dim: 10,
  /** Recently used backgrounds, newest first. */
  history: [],
}

function dshHome() {
  const configured = typeof process.env.DSH_HOME === 'string' ? process.env.DSH_HOME.trim() : ''
  if (configured !== '') return path.resolve(configured)
  return path.join(os.homedir(), '.dsh')
}

function storeRoot() {
  return path.join(dshHome(), 'storages', STORE_ID)
}

function statePath() {
  return path.join(storeRoot(), 'state.json')
}

function backgroundDir() {
  return path.join(storeRoot(), 'backgrounds')
}

function clampInt(value, min, max, fallback) {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.min(max, Math.max(min, Math.round(numeric)))
}

/** Keep the recently used backgrounds: one entry per distinct source. */
const HISTORY_LIMIT = 12

function normalizeHistory(raw) {
  if (!Array.isArray(raw)) return []
  const entries = []
  const seen = new Set()
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const key = typeof item.key === 'string' ? item.key.slice(0, 400) : ''
    if (key === '' || seen.has(key)) continue
    seen.add(key)
    entries.push({
      key,
      label: typeof item.label === 'string' ? item.label.slice(0, 120) : key,
      kind: item.kind === 'video' ? 'video' : 'image',
      source: item.source === 'path' ? 'path' : 'upload',
      file: typeof item.file === 'string' ? path.basename(item.file) : '',
      path: typeof item.path === 'string' ? item.path.trim().slice(0, 400) : '',
      poster: typeof item.poster === 'string' ? item.poster.trim().slice(0, 400) : '',
      fit: item.fit === 'contain' ? 'contain' : 'cover',
      zoom: clampInt(item.zoom, 50, 300, DEFAULT_STATE.zoom),
      posX: clampInt(item.posX, 0, 100, DEFAULT_STATE.posX),
      posY: clampInt(item.posY, 0, 100, DEFAULT_STATE.posY),
      at: Number.isFinite(item.at) ? item.at : 0,
    })
    if (entries.length >= HISTORY_LIMIT) break
  }
  return entries
}

/** Coerce any incoming object into the exact stored shape. */
function normalizeState(raw, previous) {
  const base = previous && typeof previous === 'object' ? previous : DEFAULT_STATE
  const merged = { ...base, ...(raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) }
  return {
    enabled: merged.enabled === true,
    source: merged.source === 'path' ? 'path' : 'upload',
    file: typeof merged.file === 'string' ? path.basename(merged.file) : '',
    path: typeof merged.path === 'string' ? merged.path.trim() : '',
    fit: merged.fit === 'contain' ? 'contain' : 'cover',
    zoom: clampInt(merged.zoom, 50, 300, DEFAULT_STATE.zoom),
    posX: clampInt(merged.posX, 0, 100, DEFAULT_STATE.posX),
    posY: clampInt(merged.posY, 0, 100, DEFAULT_STATE.posY),
    fill: merged.fill !== false,
    opacity: clampInt(merged.opacity, 25, 98, DEFAULT_STATE.opacity),
    blur: clampInt(merged.blur, 0, 60, DEFAULT_STATE.blur),
    dim: clampInt(merged.dim, -50, 70, DEFAULT_STATE.dim),
    history: normalizeHistory(merged.history),
  }
}

function safeUploadName(raw) {
  const name = typeof raw === 'string' ? raw : ''
  const ext = path.extname(name).toLowerCase()
  if (!IMAGE_EXT.includes(ext) && !VIDEO_EXT.includes(ext)) return null
  const stem = path
    .basename(name, path.extname(name))
    .replace(/[^\w\u4e00-\u9fa5.-]+/g, '_')
    .replace(/^[._]+/, '')
    .slice(0, 48)
  const stamp = Date.now().toString(36)
  return `${stamp}-${stem || 'background'}${ext}`
}

/* ------------------------------------------------------------------ */
/* Wallpaper Engine workshop inventory (read-only)                     */
/* ------------------------------------------------------------------ */

const WE_APP_ID = '431960'

async function readTextIfPresent(file) {
  try {
    return await fsp.readFile(file, 'utf8')
  } catch {
    return undefined
  }
}

async function fileExists(file) {
  try {
    const info = await fsp.stat(file)
    return info.isFile()
  } catch {
    return false
  }
}

/** Libraries listed in a Steam `libraryfolders.vdf` (a few "path" lines). */
function parseLibraryFolders(text) {
  const roots = new Set()
  if (typeof text !== 'string') return roots
  const pattern = /"path"\s+"([^"]+)"/g
  let match = pattern.exec(text)
  while (match !== null) {
    roots.add(match[1].replace(/\\\\/g, '\\'))
    match = pattern.exec(text)
  }
  return roots
}

/** Every Steam library that actually exists on this machine (case-insensitive dedupe). */
async function steamLibraryRoots() {
  const candidates = [
    'C:\\Program Files (x86)\\Steam',
    'C:\\Program Files\\Steam',
    'C:\\steam',
    'D:\\steam',
    'E:\\steam',
    'F:\\steam',
    'G:\\steam',
  ]
  const roots = new Map()
  for (const candidate of candidates) {
    const vdf = await readTextIfPresent(path.join(candidate, 'steamapps', 'libraryfolders.vdf'))
    if (vdf === undefined) continue
    if (!roots.has(candidate.toLowerCase())) roots.set(candidate.toLowerCase(), candidate)
    for (const extra of parseLibraryFolders(vdf)) {
      const key = extra.toLowerCase()
      if (!roots.has(key)) roots.set(key, extra)
    }
  }
  return [...roots.values()]
}

/** Pixel size from a PNG/GIF/JPEG header, without decoding the picture. */
function imageDimensions(buffer, ext) {
  try {
    if (ext === '.png' && buffer.length > 24) {
      return { w: buffer.readUInt32BE(16), h: buffer.readUInt32BE(20) }
    }
    if (ext === '.gif' && buffer.length > 10) {
      return { w: buffer.readUInt16LE(6), h: buffer.readUInt16LE(8) }
    }
    if ((ext === '.jpg' || ext === '.jpeg') && buffer.length > 4) {
      let index = 2
      while (index + 9 < buffer.length) {
        if (buffer[index] !== 0xff) {
          index += 1
          continue
        }
        const marker = buffer[index + 1]
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { w: buffer.readUInt16BE(index + 7), h: buffer.readUInt16BE(index + 5) }
        }
        if (marker === 0xd8 || marker === 0xd9) {
          index += 2
          continue
        }
        const length = buffer.readUInt16BE(index + 2)
        if (length < 2) break
        index += 2 + length
      }
    }
  } catch {
    return null
  }
  return null
}

async function readHeader(file, size) {
  try {
    const handle = await fsp.open(file, 'r')
    const buffer = Buffer.alloc(size)
    const { bytesRead } = await handle.read(buffer, 0, size, 0)
    await handle.close()
    return buffer.subarray(0, bytesRead)
  } catch {
    return undefined
  }
}

/**
 * List installed Wallpaper Engine wallpapers. Scene packs are reported as
 * `unrenderable` (their `scene.pkg` needs the WE engine), but their preview
 * still gives the user a usable static fallback.
 */
async function scanWorkshop() {
  const roots = await steamLibraryRoots()
  const items = []
  const seen = new Set()
  for (const root of roots) {
    const contentDir = path.join(root, 'steamapps', 'workshop', 'content', WE_APP_ID)
    let names
    try {
      names = await fsp.readdir(contentDir)
    } catch {
      continue
    }
    for (const id of names) {
      if (!/^\d+$/.test(id)) continue
      if (seen.has(id)) continue
      seen.add(id)
      const itemDir = path.join(contentDir, id)
      const raw = await readTextIfPresent(path.join(itemDir, 'project.json'))
      if (raw === undefined) continue
      let project
      try {
        project = JSON.parse(raw)
      } catch {
        continue
      }
      const file = typeof project.file === 'string' ? project.file : ''
      const preview = typeof project.preview === 'string' ? project.preview : ''
      const fileExt = path.extname(file).toLowerCase()
      const previewExt = path.extname(preview).toLowerCase()
      const playablePath = file === '' ? null : path.join(itemDir, file)
      const previewPath = preview === '' ? null : path.join(itemDir, preview)
      const playable = playablePath !== null && (await fileExists(playablePath)) ? playablePath : null
      const poster = previewPath !== null && (await fileExists(previewPath)) ? previewPath : null
      let posterSize = null
      if (poster !== null) {
        const header = await readHeader(poster, 65536)
        if (header !== undefined) posterSize = imageDimensions(header, previewExt)
      }
      items.push({
        id,
        title: typeof project.title === 'string' ? project.title : id,
        type: String(project.type || '').toLowerCase(),
        kind: VIDEO_EXT.includes(fileExt) ? 'video' : IMAGE_EXT.includes(fileExt) ? 'image' : 'unrenderable',
        media: playable,
        poster,
        posterKind: previewExt === '.gif' ? 'gif' : 'image',
        posterSize,
      })
    }
  }
  items.sort((left, right) => left.title.localeCompare(right.title, 'zh-Hans-CN'))
  return items
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

function sendText(res, status, text) {
  const body = String(text)
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

/** Reject writes a foreign page could trigger; loopback reads stay open. */
function isForeignRequest(req) {
  const site = req.headers['sec-fetch-site']
  return typeof site === 'string' && site === 'cross-site'
}

function readJsonBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('body-too-large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

function writeBodyToFile(req, target, limit) {
  return new Promise((resolve, reject) => {
    const out = createWriteStream(target)
    let size = 0
    let settled = false
    const fail = (error) => {
      if (settled) return
      settled = true
      out.destroy()
      req.destroy()
      reject(error)
    }
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        fail(new Error('body-too-large'))
        return
      }
      if (!out.write(chunk)) {
        req.pause()
        out.once('drain', () => req.resume())
      }
    })
    req.on('end', () => {
      if (settled) return
      out.end(() => {
        if (settled) return
        settled = true
        resolve(size)
      })
    })
    req.on('error', fail)
    out.on('error', fail)
  })
}

/**
 * Activate the host half: routes for state, upload, listing, and the background bytes.
 * @param ctx - the plugin fiber context.
 */
export function apply(ctx) {
  // Capability guard: the Client half needs `ctx.theme.overrideTokens`. Older
  // Harness releases have the theme registry but not the override layer, so say
  // so once instead of failing somewhere deep in the browser.
  if (typeof ctx.get === 'function') {
    const theme = ctx.get('theme')
    if (theme !== undefined && typeof theme.overrideTokens !== 'function') {
      ctx.logger?.warn?.('[dsh-ui-background] theme.overrideTokens missing: glass stays off, wallpaper still works.')
    }
  }
  const stateFile = statePath()
  const uploadDir = backgroundDir()

  let state = { ...DEFAULT_STATE }
  let readyPromise = null
  let writeChain = Promise.resolve()
  /** Cached workshop scan; a full scan hits the disk for every wallpaper. */
  let workshopCache = null
  let workshopCachedAt = 0

  function ensureReady() {
    if (!readyPromise) {
      readyPromise = (async () => {
        try {
          const text = await fsp.readFile(stateFile, 'utf8')
          state = normalizeState(JSON.parse(text), state)
        } catch (error) {
          if (!error || error.code !== 'ENOENT') {
            ctx.logger?.warn?.(`[dsh-ui-background] state unreadable, using defaults: ${error && error.message}`)
          }
        }
        return state
      })()
    }
    return readyPromise
  }

  function persist() {
    const snapshot = `${JSON.stringify(state, null, 2)}\n`
    const run = writeChain.then(async () => {
      await fsp.mkdir(storeRoot(), { recursive: true })
      const temp = `${stateFile}.tmp`
      await fsp.writeFile(temp, snapshot, 'utf8')
      await fsp.rename(temp, stateFile)
    })
    writeChain = run.then(
      () => undefined,
      (error) => {
        ctx.logger?.warn?.(`[dsh-ui-background] state write failed: ${error && error.message}`)
      },
    )
    return run
  }

  /** Resolve which file the current state points at, or null when it points nowhere usable. */
  async function resolveBackground() {
    if (state.source === 'path') {
      const candidate = state.path === '' ? '' : path.resolve(state.path)
      if (candidate === '') return null
      const ext = path.extname(candidate).toLowerCase()
      if (!IMAGE_EXT.includes(ext) && !VIDEO_EXT.includes(ext)) return null
      try {
        const info = await fsp.stat(candidate)
        return info.isFile() ? candidate : null
      } catch {
        return null
      }
    }
    if (state.source === 'upload' && state.file !== '') {
      const candidate = path.join(uploadDir, path.basename(state.file))
      try {
        const info = await fsp.stat(candidate)
        return info.isFile() ? candidate : null
      } catch {
        return null
      }
    }
    return null
  }

  async function handleState(req, res) {
    await ensureReady()
    if (req.method === 'GET' || req.method === 'HEAD') {
      sendJson(res, 200, state)
      return
    }
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'method-not-allowed' })
      return
    }
    if (isForeignRequest(req)) {
      sendJson(res, 403, { error: 'cross-site-write' })
      return
    }
    let patch
    try {
      patch = await readJsonBody(req, MAX_JSON_BYTES)
    } catch (error) {
      sendJson(res, 400, { error: 'bad-json', detail: String(error && error.message) })
      return
    }
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      sendJson(res, 400, { error: 'bad-json' })
      return
    }
    state = normalizeState(patch, state)
    await persist()
    sendJson(res, 200, state)
  }

  async function handleUpload(req, res) {
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'method-not-allowed' })
      return
    }
    if (isForeignRequest(req)) {
      sendJson(res, 403, { error: 'cross-site-write' })
      return
    }
    await ensureReady()
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const requested = url.searchParams.get('name') ?? req.headers['x-dsh-bg-name'] ?? ''
    const fileName = safeUploadName(typeof requested === 'string' ? requested : '')
    if (fileName === null) {
      sendJson(res, 415, { error: 'unsupported-type', detail: 'jpg/png/webp/gif/avif/bmp/mp4/webm/mkv/mov' })
      return
    }
    await fsp.mkdir(uploadDir, { recursive: true })
    const target = path.join(uploadDir, fileName)
    try {
      await writeBodyToFile(req, target, MAX_UPLOAD_BYTES)
    } catch (error) {
      await fsp.rm(target, { force: true })
      sendJson(res, 413, { error: 'upload-failed', detail: String(error && error.message) })
      return
    }
    state = normalizeState({ ...state, enabled: true, source: 'upload', file: fileName }, state)
    await persist()
    sendJson(res, 200, { ok: true, state })
  }

  async function handleFiles(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { error: 'method-not-allowed' })
      return
    }
    let entries = []
    try {
      const names = await fsp.readdir(uploadDir)
      for (const entry of names) {
        const ext = path.extname(entry).toLowerCase()
        if (!IMAGE_EXT.includes(ext) && !VIDEO_EXT.includes(ext)) continue
        try {
          const info = await fsp.stat(path.join(uploadDir, entry))
          entries.push({ file: entry, size: info.size, mtime: info.mtimeMs })
        } catch {
          /* a file that vanished between readdir and stat is simply not listed */
        }
      }
    } catch (error) {
      if (!error || error.code !== 'ENOENT') {
        sendJson(res, 500, { error: 'list-failed' })
        return
      }
    }
    entries.sort((left, right) => right.mtime - left.mtime)
    sendJson(res, 200, { files: entries })
  }

  async function handleWorkshop(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { error: 'method-not-allowed' })
      return
    }
    let items = workshopCache
    const now = Date.now()
    if (items === null || now - workshopCachedAt > 15000) {
      try {
        items = await scanWorkshop()
        workshopCache = items
        workshopCachedAt = now
      } catch (error) {
        sendJson(res, 500, { error: 'scan-failed', detail: String(error && error.message) })
        return
      }
    }
    sendJson(res, 200, {
      roots: await steamLibraryRoots(),
      items: items.map((item) => ({
        id: item.id,
        title: item.title,
        type: item.type,
        kind: item.kind,
        media: item.media,
        poster: item.poster,
        posterKind: item.posterKind,
        posterSize: item.posterSize,
        hasPoster: item.poster !== null,
      })),
    })
  }

  async function handleWorkshopPoster(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { error: 'method-not-allowed' })
      return
    }
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const id = url.searchParams.get('id') ?? ''
    if (!/^\d+$/.test(id)) {
      sendJson(res, 400, { error: 'bad-id' })
      return
    }
    if (workshopCache === null) {
      try {
        workshopCache = await scanWorkshop()
        workshopCachedAt = Date.now()
      } catch {
        sendJson(res, 500, { error: 'scan-failed' })
        return
      }
    }
    const item = workshopCache.find((entry) => entry.id === id)
    if (!item || item.poster === null) {
      sendText(res, 404, 'no poster')
      return
    }
    const ext = path.extname(item.poster).toLowerCase()
    const type = MIME[ext] ?? 'application/octet-stream'
    let body
    try {
      body = await fsp.readFile(item.poster)
    } catch {
      sendText(res, 404, 'poster unreadable')
      return
    }
    res.writeHead(200, {
      'content-type': type,
      'cache-control': 'no-store',
      'content-length': body.length,
    })
    res.end(body)
  }

  async function handleDelete(req, res) {
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'method-not-allowed' })
      return
    }
    if (isForeignRequest(req)) {
      sendJson(res, 403, { error: 'cross-site-write' })
      return
    }
    await ensureReady()
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const requested = url.searchParams.get('name') ?? ''
    const name = path.basename(String(requested))
    if (name === '' || !/^[\w\u4e00-\u9fa5.-]+$/.test(name)) {
      sendJson(res, 400, { error: 'bad-name' })
      return
    }
    const target = path.join(uploadDir, name)
    try {
      await fsp.rm(target, { force: true })
    } catch (error) {
      sendJson(res, 500, { error: 'delete-failed', detail: String(error && error.message) })
      return
    }
    const history = state.history.filter((item) => !(item.source === 'upload' && item.file === name))
    const wasCurrent = state.source === 'upload' && state.file === name
    state = normalizeState(
      {
        ...state,
        history,
        ...(wasCurrent ? { enabled: false, file: '' } : {}),
      },
      state,
    )
    await persist()
    sendJson(res, 200, { ok: true, stopped: wasCurrent, state })
  }
  /** Identity of the media the Host state currently points at. */
  function currentStateKey() {
    const name = state.source === 'path' ? state.path : state.file
    return name === '' ? '' : `${state.source}:${name}`
  }

  /**
   * Resolve an entry to the file a BACKGROUND should use: the real media first,
   * the poster only when nothing playable exists. (`fileOfEntry` below is the
   * thumbnail order and prefers the poster — mixing the two served a JPEG into
   * a <video> element.)
   */
  function mediaOfEntry(entry) {
    if (entry === undefined || entry === null) return null
    if (entry.source === 'upload' && entry.file !== '') {
      return path.join(backgroundDir(), path.basename(entry.file))
    }
    if (entry.source === 'path' && entry.path !== '') return entry.path
    if (entry.poster !== '') return entry.poster
    return null
  }

  /** Resolve a history entry (or the live state) to an absolute file path. */
  function fileOfEntry(entry) {
    if (entry === undefined || entry === null) return null
    if (entry.poster !== '') return entry.poster
    if (entry.source === 'upload' && entry.file !== '') {
      return path.join(backgroundDir(), path.basename(entry.file))
    }
    if (entry.source === 'path' && entry.path !== '') return entry.path
    return null
  }
  async function handleThumb(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { error: 'method-not-allowed' })
      return
    }
    await ensureReady()
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const key = url.searchParams.get('key') ?? ''
    const entry = state.history.find((item) => item.key === key)
    if (entry === undefined) {
      sendText(res, 404, 'unknown history entry')
      return
    }
    const file = fileOfEntry(entry)
    if (file === null) {
      sendText(res, 404, 'no thumbnail')
      return
    }
    const ext = path.extname(file).toLowerCase()
    if (!IMAGE_EXT.includes(ext)) {
      sendText(res, 404, 'not an image')
      return
    }
    let body
    try {
      body = await fsp.readFile(file)
    } catch {
      sendText(res, 404, 'unreadable')
      return
    }
    res.writeHead(200, {
      'content-type': MIME[ext] ?? 'application/octet-stream',
      'cache-control': 'no-store',
      'content-length': body.length,
    })
    res.end(body)
  }
  async function handleBackground(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { error: 'method-not-allowed' })
      return
    }
    await ensureReady()
    const query = new URL(req.url ?? '/', 'http://127.0.0.1')
    const requestedKey = query.searchParams.get('key')
    let file
    if (typeof requestedKey === 'string' && requestedKey !== '') {
      // Exact selection: serve the asked-for entry, not whatever the Host state
      // happens to say right now (a click is posted a moment later).
      file = mediaOfEntry(state.history.find((item) => item.key === requestedKey))
      if (file === null && requestedKey === currentStateKey()) {
        // No history entry yet (fresh upload): the live state is the authority.
        file = await resolveBackground()
      }
      if (file === null) {
        sendText(res, 404, 'unknown background key')
        return
      }
    } else {
      file = await resolveBackground()
    }
    if (file === null) {
      sendText(res, 404, 'no background configured')
      return
    }
    let info
    try {
      info = await fsp.stat(file)
    } catch {
      sendText(res, 404, 'background file missing')
      return
    }
    const total = info.size
    const ext = path.extname(file).toLowerCase()
    const type = MIME[ext] ?? 'application/octet-stream'
    const headers = {
      'content-type': type,
      'cache-control': 'no-store',
      'cross-origin-resource-policy': 'same-origin',
      'accept-ranges': 'bytes',
    }

    const range = req.headers.range
    if (typeof range === 'string') {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
      if (match) {
        const startText = match[1]
        const endText = match[2]
        let start = startText === '' ? null : Number(startText)
        let end = endText === '' ? null : Number(endText)
        if (start === null && end !== null) {
          start = Math.max(0, total - end)
          end = total - 1
        } else {
          if (start === null) start = 0
          if (end === null) end = total - 1
        }
        end = Math.min(end, total - 1)
        if (start > end || start >= total) {
          res.writeHead(416, { 'content-range': `bytes */${total}` })
          res.end()
          return
        }
        res.writeHead(206, {
          ...headers,
          'content-range': `bytes ${start}-${end}/${total}`,
          'content-length': end - start + 1,
        })
        if (req.method === 'HEAD') {
          res.end()
          return
        }
        const stream = createReadStream(file, { start, end })
        stream.on('error', () => res.destroy())
        stream.pipe(res)
        return
      }
    }

    res.writeHead(200, { ...headers, 'content-length': total })
    if (req.method === 'HEAD') {
      res.end()
      return
    }
    const stream = createReadStream(file)
    stream.on('error', () => res.destroy())
    stream.pipe(res)
  }

  ctx.effect(() => {
    const disposers = [
      ctx.webServer.register({ kind: 'exact', path: `${BASE}/state`, handler: handleState }),
      ctx.webServer.register({ kind: 'exact', path: `${BASE}/upload`, handler: handleUpload }),
      ctx.webServer.register({ kind: 'exact', path: `${BASE}/files`, handler: handleFiles }),
      ctx.webServer.register({ kind: 'exact', path: `${BASE}/background`, handler: handleBackground }),
      ctx.webServer.register({ kind: 'exact', path: `${BASE}/workshop`, handler: handleWorkshop }),
      ctx.webServer.register({ kind: 'exact', path: `${BASE}/workshop-poster`, handler: handleWorkshopPoster }),
      ctx.webServer.register({ kind: 'exact', path: `${BASE}/thumb`, handler: handleThumb }),
      ctx.webServer.register({ kind: 'exact', path: `${BASE}/delete`, handler: handleDelete }),
    ]
    return () => {
      for (const dispose of disposers) dispose()
    }
  })

  void ensureReady()
}
