/**
 * Client half of the local background plugin (v0.4).
 *
 * One media layer behind the app columns holds EITHER an <img> or a <video>,
 * positioned with object-fit / object-position / transform. That is deliberate:
 * the earlier version sized a CSS background from the picture's natural size,
 * so whenever that measurement was unavailable the "fit / zoom" controls did
 * nothing. Geometry now comes from the same three numbers for both kinds, which
 * also makes the in-page preview exactly what the page shows.
 *
 * Glass panels stay on official theme tokens (ctx.theme.overrideTokens).
 */
window.__ModuleLoader__.load({
  id: 'dsh-ui-background',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const BASE = '/dsh-ui-background'
    const SOURCE_ID = 'dsh-ui-background'
    const STYLE_ID = 'dsh-ui-background-style'
    const LAYER_ID = 'dsh-ui-background-layer'
    const SECTION_ID = 'background'

    const DEFAULT_VALUE = {
      enabled: false,
      source: 'upload',
      file: '',
      path: '',
      fit: 'cover',
      zoom: 100,
      posX: 50,
      posY: 50,
      fill: true,
      opacity: 72,
      blur: 24,
      dim: 10,
      history: [],
    }

    const VIDEO_PATTERN = /\.(mp4|webm|mkv|mov)$/i

    const CSS = `
/* 浮在实时内容上的对话框（设置面板就是它）：
   本地把被覆盖的令牌抬到近不透明，并补一层背景模糊。 */
html[data-dsh-bg="on"] [role="dialog"] {
  --dsw-alias-bg-base: rgba(255, 255, 255, 0.94);
  --dsw-alias-bg-layer-1: rgba(255, 255, 255, 0.96);
  --dsw-alias-bg-layer-2: rgba(255, 255, 255, 0.96);
  --dsw-alias-bg-overlay: rgba(255, 255, 255, 0.97);
  backdrop-filter: blur(20px) saturate(1.06);
}
html[data-dsh-bg="on"] body[data-ds-dark-theme] [role="dialog"] {
  --dsw-alias-bg-base: rgba(21, 21, 23, 0.94);
  --dsw-alias-bg-layer-1: rgba(35, 35, 36, 0.96);
  --dsw-alias-bg-layer-2: rgba(44, 44, 46, 0.96);
  --dsw-alias-bg-overlay: rgba(97, 102, 107, 0.97);
}

/* 指令面板 / 下拉列表：它们自己没有底色，会直接透出背景。
   与对话框同样处理：抬令牌 + 补一层模糊。 */
html[data-dsh-bg-kind] [role="listbox"] {
  --dsw-alias-bg-base: rgba(255, 255, 255, 0.94);
  --dsw-alias-bg-layer-1: rgba(255, 255, 255, 0.96);
  --dsw-alias-bg-layer-2: rgba(255, 255, 255, 0.96);
  --dsw-alias-bg-overlay: rgba(255, 255, 255, 0.97);
  background-color: rgba(255, 255, 255, 0.94);
  backdrop-filter: blur(18px) saturate(1.05);
}
html[data-dsh-bg-kind] body[data-ds-dark-theme] [role="listbox"] {
  --dsw-alias-bg-base: rgba(21, 21, 23, 0.94);
  --dsw-alias-bg-layer-1: rgba(35, 35, 36, 0.96);
  --dsw-alias-bg-layer-2: rgba(44, 44, 46, 0.96);
  --dsw-alias-bg-overlay: rgba(97, 102, 107, 0.97);
  background-color: rgba(21, 21, 23, 0.94);
}
/*
 * 输入区底托：压在滚动中的聊天文字上。
 * 图片背景：用背景模糊挡掉文字，同时保留壁纸的光感（不再糊一层白）。
 * 视频背景：不加模糊（省 GPU），只抬一点不透明度。
 */
/*
 * 输入框卡片：只给「卡片」上底色，不碰它外面那块 seat。
 * seat 在首页包住"标题 + 输入框"整块，给它上底色/模糊会变成一条随输入框伸缩的雾带。
 * 挡字靠不透明度，不靠模糊。
 */
html[data-dsh-bg-kind] [data-composer-card] {
  --dsw-alias-bg-base: rgba(255, 255, 255, 0.86);
  --dsw-alias-bg-layer-1: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(var(--dsh-bg-blur, 0px)) saturate(1.04);
}
html[data-dsh-bg-kind] body[data-ds-dark-theme] [data-composer-card] {
  --dsw-alias-bg-base: rgba(24, 24, 26, 0.86);
  --dsw-alias-bg-layer-1: rgba(35, 35, 37, 0.9);
}
`

    /* ------------------------------------------------------------------ */
    /* helpers                                                             */
    /* ------------------------------------------------------------------ */

    function mediaName(value) {
      return value.source === 'path' ? String(value.path ?? '').trim() : String(value.file ?? '')
    }

    function kindOf(value) {
      const name = mediaName(value)
      if (name === '') return 'none'
      return VIDEO_PATTERN.test(name) ? 'video' : 'image'
    }

    function clamp(value, min, max) {
      if (!Number.isFinite(value)) return min
      if (value < min) return min
      if (value > max) return max
      return Math.round(value)
    }

    function normalize(raw, previous) {
      const base = previous ?? DEFAULT_VALUE
      const merged = Object.assign({}, base, raw && typeof raw === 'object' ? raw : {})
      return {
        enabled: merged.enabled === true,
        source: merged.source === 'path' ? 'path' : 'upload',
        file: typeof merged.file === 'string' ? merged.file : '',
        path: typeof merged.path === 'string' ? merged.path : '',
        fit: merged.fit === 'contain' ? 'contain' : 'cover',
        zoom: clamp(Number(merged.zoom), 50, 300),
        posX: clamp(Number(merged.posX), 0, 100),
        posY: clamp(Number(merged.posY), 0, 100),
        fill: merged.fill !== false,
        opacity: clamp(Number(merged.opacity), 25, 98),
        blur: clamp(Number(merged.blur), 0, 60),
        dim: clamp(Number(merged.dim), -50, 70),
        history: normalizeHistory(merged.history),
      }
    }

    const HISTORY_LIMIT = 12

    function normalizeHistory(raw) {
      if (!Array.isArray(raw)) return []
      const out = []
      const seen = new Set()
      for (const item of raw) {
        if (!item || typeof item !== 'object') continue
        const key = typeof item.key === 'string' ? item.key : ''
        if (key === '' || seen.has(key)) continue
        seen.add(key)
        out.push({
          key,
          label: typeof item.label === 'string' ? item.label : key,
          kind: item.kind === 'video' ? 'video' : 'image',
          source: item.source === 'path' ? 'path' : 'upload',
          file: typeof item.file === 'string' ? item.file : '',
          path: typeof item.path === 'string' ? item.path : '',
          poster: typeof item.poster === 'string' ? item.poster : '',
          fit: item.fit === 'contain' ? 'contain' : 'cover',
          zoom: clamp(Number(item.zoom), 50, 300),
          posX: clamp(Number(item.posX), 0, 100),
          posY: clamp(Number(item.posY), 0, 100),
          at: Number.isFinite(item.at) ? item.at : 0,
        })
        if (out.length >= HISTORY_LIMIT) break
      }
      return out
    }

    function tintColor(dim) {
      if (dim > 0) return `rgba(0, 0, 0, ${(dim / 100).toFixed(3)})`
      if (dim < 0) return `rgba(255, 255, 255, ${(-dim / 100).toFixed(3)})`
      return 'rgba(0, 0, 0, 0)'
    }

    function alpha(value) {
      return Number(value.toFixed(3))
    }

    /**
     * One geometry model for the real layer and the preview.
     *
     * `object-position` cannot pan a scaled layer: under `contain` the picture
     * already fills the fitted axis inside its box, and `scale()` grows about
     * the centre, so that axis never moves. Panning therefore has to be a
     * transform translation. Offsets are returned as a fraction of the box so
     * the same numbers are valid for a viewport-sized layer and for a
     * thumbnail that shares the viewport's aspect ratio.
     */
    function layout(value, size) {
      const viewW = Math.max(1, window.innerWidth)
      const viewH = Math.max(1, window.innerHeight)
      // A small extra scale hides the translucent rim blur leaves at the edges.
      const compensation = value.blur > 0 ? 1.06 : 1
      const zoom = (value.zoom / 100) * compensation
      if (!size || size.w <= 0 || size.h <= 0) {
        return { zoom, tx: 0, ty: 0, rangeX: true, rangeY: true, viewW, viewH }
      }
      const fit = value.fit === 'contain'
        ? Math.min(viewW / size.w, viewH / size.h)
        : Math.max(viewW / size.w, viewH / size.h)
      const contentW = size.w * fit * zoom
      const contentH = size.h * fit * zoom
      const overflowX = Math.max(0, contentW - viewW)
      const overflowY = Math.max(0, contentH - viewH)
      return {
        zoom,
        tx: ((0.5 - value.posX / 100) * overflowX) / viewW,
        ty: ((0.5 - value.posY / 100) * overflowY) / viewH,
        /** Overflow as a fraction of the box: the slack a drag can travel. */
        padX: overflowX / viewW,
        padY: overflowY / viewH,
        rangeX: overflowX > 2,
        rangeY: overflowY > 2,
        viewW,
        viewH,
      }
    }

    /** Style for the media element; pan rides on `translate`, never `object-position`. */
    function mediaStyle(value, size) {
      const geo = layout(value, size)
      return {
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        objectFit: value.fit === 'contain' ? 'contain' : 'cover',
        objectPosition: '50% 50%',
        transform: `translate(${(geo.tx * 100).toFixed(3)}%, ${(geo.ty * 100).toFixed(3)}%) scale(${geo.zoom.toFixed(4)})`,
        transformOrigin: '50% 50%',
        filter: value.blur > 0 ? `blur(${value.blur}px)` : 'none',
        pointerEvents: 'none',
        userSelect: 'none',
      }
    }

    /** The shipped light/dark palette hues, only carrying alpha. */
    function buildTokens(value) {
      const surface = value.opacity / 100
      const baseLight = `rgba(255, 255, 255, ${alpha(surface)})`
      const baseDark = `rgba(21, 21, 23, ${alpha(surface)})`
      const sideLight = `rgba(249, 250, 251, ${alpha(surface)})`
      const sideDark = `rgba(27, 27, 28, ${alpha(surface)})`
      const raisedOne = alpha(Math.min(0.985, Math.max(0.86, surface + 0.16)))
      const raisedTwo = alpha(Math.min(0.99, Math.max(0.88, surface + 0.2)))
      const overlay = alpha(Math.min(0.99, Math.max(0.9, surface + 0.24)))
      return {
        '--dsw-alias-bg-base': { light: baseLight, dark: baseDark },
        '--dsw-specific-sidebar-fill': { light: sideLight, dark: sideDark },
        '--dsw-alias-bg-layer-1': {
          light: `rgba(255, 255, 255, ${raisedOne})`,
          dark: `rgba(35, 35, 36, ${raisedOne})`,
        },
        '--dsw-alias-bg-layer-2': {
          light: `rgba(255, 255, 255, ${raisedTwo})`,
          dark: `rgba(44, 44, 46, ${raisedTwo})`,
        },
        '--dsw-alias-bg-overlay': {
          light: `rgba(233, 236, 242, ${overlay})`,
          dark: `rgba(97, 102, 107, ${overlay})`,
        },
      }
    }

    /* ------------------------------------------------------------------ */
    /* runtime                                                             */
    /* ------------------------------------------------------------------ */

    function createRuntime(ctx) {
      const listeners = new Set()
      let snapshot = {
        value: Object.assign({}, DEFAULT_VALUE),
        load: 'loading',
        save: 'idle',
        media: 'unknown',
        size: null,
        layer: 'off',
        error: '',
      }
      let revision = Date.now().toString(36)
      /** Bumped on every local edit; a Host echo older than this must not win. */
      let changeSeq = 0
      /** Set when the chosen media changed and the Host has not echoed it yet. */
      let mediaDirty = false
      let mediaKey = ''
      let tokenDisposer = null
      let saveTimer = null
      let layer = null
      /** Natural pixel size of the current media, measured from the element itself. */
      let naturalSize = null

      function notify() {
        listeners.forEach((listener) => {
          try {
            listener()
          } catch (error) {
            console.error('[dsh-ui-background] listener failed', error)
          }
        })
      }

      function patchSnapshot(patch) {
        snapshot = Object.assign({}, snapshot, patch)
        notify()
      }

      function getSnapshot() {
        return snapshot
      }

      function subscribe(listener) {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      }

      function mediaUrl() {
        const current = snapshot.value
        const name = mediaName(current)
        if (name === '') return `${BASE}/background?v=${revision}`
        const key = `${current.source}:${name}`
        return `${BASE}/background?key=${encodeURIComponent(key)}&v=${revision}`
      }

      function disposeTokenLayer() {
        if (tokenDisposer) {
          try {
            tokenDisposer()
          } catch (error) {
            console.error('[dsh-ui-background] token layer disposal failed', error)
          }
          tokenDisposer = null
        }
      }

      function removeLayer() {
        // Duplicates can survive a failed rebuild; clear every box carrying our id.
        const stale = document.querySelectorAll(`#${LAYER_ID}`)
        for (const box of stale) {
          const video = box.querySelector('video')
          if (video !== null) {
            try {
              video.pause()
            } catch (error) {
              /* a detached element is already silent */
            }
            video.removeAttribute('src')
            try {
              video.load()
            } catch (error) {
              /* nothing left to release */
            }
          }
          box.remove()
        }
        layer = null
        mediaKey = ''
        naturalSize = null
      }

      function ensureLayer(kind) {
        if (layer !== null && mediaKey.startsWith(`${kind}:`)) return layer
        removeLayer()

        const box = document.createElement('div')
        box.id = LAYER_ID
        box.setAttribute('aria-hidden', 'true')
        box.style.cssText = [
          'position:fixed',
          'inset:0',
          'z-index:-1',
          'pointer-events:none',
          'overflow:hidden',
          'background:#000',
        ].join(';')

        let media
        if (kind === 'video') {
          media = document.createElement('video')
          media.muted = true
          media.defaultMuted = true
          media.loop = true
          media.autoplay = true
          media.playsInline = true
          media.setAttribute('muted', '')
          media.setAttribute('playsinline', '')
          media.preload = 'auto'
        } else {
          media = document.createElement('img')
          media.alt = ''
          media.decoding = 'async'
        }
        media.setAttribute('data-dsh-bg-media', '')

        const tint = document.createElement('div')
        tint.setAttribute('data-dsh-bg-tint', '')
        tint.style.cssText = 'position:absolute;inset:0;pointer-events:none'

        // Letterbox filler: the same media, blown up and blurred, so the area
        // beside a `contain` picture carries the picture's own light instead of
        // a flat black block. That is what keeps panel brightness continuous.
        const fill = document.createElement('div')
        fill.setAttribute('data-dsh-bg-fill', '')
        fill.style.cssText = [
          'position:absolute',
          'inset:0',
          'pointer-events:none',
          'background-size:cover',
          'background-position:center',
          'background-repeat:no-repeat',
          'transform-origin:50% 50%',
          'display:none',
        ].join(';')

        box.appendChild(fill)
        box.appendChild(media)
        box.appendChild(tint)
        document.body.appendChild(box)
        layer = box
        mediaKey = `${kind}:pending`
        return layer
      }

      function applyLayer(value, kind) {
        const box = ensureLayer(kind)
        const media = box.querySelector('[data-dsh-bg-media]')
        const tint = box.querySelector('[data-dsh-bg-tint]')
        if (media === null || tint === null) return

        const key = `${kind}:${mediaName(value)}`
        if (mediaKey !== key) {
          mediaKey = key
          naturalSize = null
          patchSnapshot({ size: null })
          // The element may be reused for a different file: force a fresh measurement.
          delete media.dataset.dshMeasured
          media.setAttribute('src', mediaUrl())
          if (kind === 'video') media.load()
        }

        // Measure the media itself; without it the pan range is unknown and the
        // layer would fall back to a centred, unmovable picture.
        if (naturalSize === null && media.dataset.dshMeasured !== '1') {
          media.dataset.dshMeasured = '1'
          const measure = () => {
            const w = kind === 'video' ? media.videoWidth : media.naturalWidth
            const h = kind === 'video' ? media.videoHeight : media.naturalHeight
            if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return
            naturalSize = { w, h }
            patchSnapshot({ size: naturalSize })
            applyLayer(snapshot.value, kindOf(snapshot.value))
          }
          media.addEventListener(kind === 'video' ? 'loadedmetadata' : 'load', measure)
          if (kind === 'image' && media.complete) measure()
          if (kind === 'video') {
            media.addEventListener(
              'error',
              () => patchSnapshot({ error: '视频加载失败：可能是容器/编码浏览器不支持（mp4/H.264 最稳，mkv 基本不支持）' }),
              { once: true },
            )
          }
        }

        const style = mediaStyle(value, naturalSize)
        media.style.position = style.position
        media.style.inset = `${style.inset}px`
        media.style.width = style.width
        media.style.height = style.height
        media.style.objectFit = style.objectFit
        media.style.objectPosition = style.objectPosition
        media.style.transform = style.transform
        media.style.transformOrigin = style.transformOrigin
        media.style.filter = style.filter
        media.style.pointerEvents = 'none'

        tint.style.background = tintColor(value.dim)

        const fill = box.querySelector('[data-dsh-bg-fill]')
        const fillOn = value.fit === 'contain' && value.fill === true
        box.style.background = fillOn ? 'transparent' : '#000'
        if (fill !== null) {
          fill.style.display = fillOn ? 'block' : 'none'
          if (fillOn) {
            fill.style.filter = `blur(${Math.round(value.blur + 36)}px) brightness(0.92)`
            fill.style.transform = 'scale(1.2)'
            if (kind === 'image') {
              fill.style.backgroundImage = `url("${mediaUrl()}")`
              const stale = fill.querySelector('video')
              if (stale !== null) stale.remove()
            } else {
              fill.style.backgroundImage = 'none'
              let filler = fill.querySelector('video')
              if (filler === null) {
                filler = document.createElement('video')
                filler.muted = true
                filler.defaultMuted = true
                filler.loop = true
                filler.playsInline = true
                filler.setAttribute('muted', '')
                filler.setAttribute('playsinline', '')
                filler.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover'
                fill.appendChild(filler)
              }
              if (filler.getAttribute('src') !== mediaUrl()) {
                filler.setAttribute('src', mediaUrl())
                filler.load()
              }
              const attemptFill = filler.play()
              if (attemptFill && typeof attemptFill.catch === 'function') attemptFill.catch(() => undefined)
            }
          } else {
            const paused = fill.querySelector('video')
            if (paused !== null) {
              try {
                paused.pause()
              } catch (error) {
                /* already paused */
              }
            }
          }
        }

        if (kind === 'video') {
          const attempt = media.play()
          if (attempt && typeof attempt.catch === 'function') {
            attempt.catch((error) => {
              patchSnapshot({ error: `视频无法播放：${error && error.message ? error.message : String(error)}` })
            })
          }
        }
      }

      function applyVisual() {
        const value = snapshot.value
        const root = document.documentElement
        const kind = kindOf(value)

        if (!value.enabled || kind === 'none') {
          root.removeAttribute('data-dsh-bg')
          root.removeAttribute('data-dsh-bg-kind')
          removeLayer()
          disposeTokenLayer()
          if (snapshot.layer !== 'off') patchSnapshot({ layer: 'off' })
          return
        }

        root.style.setProperty('--dsh-bg-blur', `${value.blur}px`)
        root.setAttribute('data-dsh-bg', 'on')
        root.setAttribute('data-dsh-bg-kind', kind)
        disposeTokenLayer()
        try {
          tokenDisposer = ctx.theme.overrideTokens(SOURCE_ID, buildTokens(value))
        } catch (error) {
          console.error('[dsh-ui-background] token override failed', error)
          patchSnapshot({ error: '主题令牌覆盖失败，请查看控制台' })
        }

        applyLayer(value, kind)
        const boxes = document.querySelectorAll(`#${LAYER_ID}`).length
        const layerState = `${kind}:${boxes}`
        if (snapshot.layer !== layerState) patchSnapshot({ layer: layerState })
      }

      function historyEntryOf(value, extra) {
        const kind = kindOf(value)
        if (kind === 'none') return null
        const name = mediaName(value)
        const base = name.split(/[\\/]/).pop() || name
        return {
          key: `${value.source}:${name}`,
          label: extra && typeof extra.label === 'string' && extra.label !== '' ? extra.label : base,
          kind,
          source: value.source,
          file: value.source === 'upload' ? value.file : '',
          path: value.source === 'path' ? value.path : '',
          poster: extra && typeof extra.poster === 'string' ? extra.poster : '',
          fit: value.fit,
          zoom: value.zoom,
          posX: value.posX,
          posY: value.posY,
          at: Date.now(),
        }
      }

      function commit(next, extra) {
        const previous = snapshot.value
        const mediaChanged =
          mediaName(previous) !== mediaName(next) ||
          kindOf(previous) !== kindOf(next)
        let history = snapshot.value.history
        if (mediaChanged) {
          const entry = historyEntryOf(next, extra)
          if (entry !== null) {
            const rest = history.filter((item) => item.key !== entry.key)
            history = [entry].concat(rest).slice(0, HISTORY_LIMIT)
            next = Object.assign({}, next, { history })
          }
        }
        if (!mediaChanged) {
          // Same picture, new framing: keep the history entry in step with it.
          const name = mediaName(next)
          if (name !== '') {
            const key = `${next.source}:${name}`
            const updated = next.history.map((item) =>
              item.key === key
                ? Object.assign({}, item, {
                  fit: next.fit,
                  zoom: next.zoom,
                  posX: next.posX,
                  posY: next.posY,
                })
                : item,
            )
            next = Object.assign({}, next, { history: updated })
          }
        }
        snapshot = Object.assign({}, snapshot, { value: next })
        changeSeq += 1
        if (mediaChanged) {
          mediaDirty = true
          revision = Date.now().toString(36)
          mediaKey = ''
          snapshot = Object.assign({}, snapshot, { media: 'unknown', size: null })
        }
        applyVisual()
        notify()
        if (mediaChanged) {
          // The Host serves whatever ITS state says, so it has to know first.
          if (saveTimer) {
            clearTimeout(saveTimer)
            saveTimer = null
          }
          void flush()
        } else {
          scheduleSave()
        }
      }

      function scheduleSave() {
        if (saveTimer) clearTimeout(saveTimer)
        saveTimer = setTimeout(() => {
          saveTimer = null
          void flush()
        }, 320)
      }

      async function flush() {
        const seq = changeSeq
        patchSnapshot({ save: 'saving', error: '' })
        try {
          const response = await fetch(`${BASE}/state`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(snapshot.value),
          })
          if (!response.ok) {
            patchSnapshot({ save: 'error', error: `保存被拒绝（HTTP ${response.status}）` })
            return
          }
          const answer = await response.json()
          if (changeSeq === seq) {
            if (mediaDirty) {
              // Host now holds the new media: re-request it under a fresh URL.
              mediaDirty = false
              revision = Date.now().toString(36)
              mediaKey = ''
            }
            patchSnapshot({ save: 'saved', value: normalize(answer, snapshot.value), load: 'ready' })
            applyVisual()
          } else {
            // A newer local choice is already on screen; do not let this echo revert it.
            patchSnapshot({ save: 'saved' })
          }
        } catch (error) {
          patchSnapshot({
            save: 'error',
            error: `保存失败：${error && error.message ? error.message : String(error)}`,
          })
        }
      }

      async function load() {
        try {
          const response = await fetch(`${BASE}/state`, { headers: { accept: 'application/json' } })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const answer = await response.json()
          const loaded = normalize(answer, DEFAULT_VALUE)
          let missingEntry = false
          if (kindOf(loaded) !== 'none') {
            const entry = historyEntryOf(loaded, {})
            if (entry !== null && !loaded.history.some((item) => item.key === entry.key)) {
              loaded.history = [entry].concat(loaded.history).slice(0, HISTORY_LIMIT)
              missingEntry = true
            }
          }
          snapshot = Object.assign({}, snapshot, { value: loaded, load: 'ready' })
          if (missingEntry) scheduleSave()
        } catch (error) {
          patchSnapshot({
            load: 'error',
            error: `读取设置失败：${error && error.message ? error.message : String(error)}`,
          })
        }
        applyVisual()
        notify()
      }

      async function upload(file) {
        patchSnapshot({ save: 'saving', error: '' })
        try {
          const response = await fetch(`${BASE}/upload?name=${encodeURIComponent(file.name ?? 'background')}`, {
            method: 'POST',
            headers: { 'content-type': file.type || 'application/octet-stream' },
            body: file,
          })
          if (!response.ok) {
            patchSnapshot({ save: 'error', error: `上传被拒绝（HTTP ${response.status}）` })
            return
          }
          const answer = await response.json()
          const answered = normalize(answer && answer.state, snapshot.value)
          snapshot = Object.assign({}, snapshot, { save: 'saved', load: 'ready' })
          commit(answered, { label: answered.file })
        } catch (error) {
          patchSnapshot({
            save: 'error',
            error: `上传失败：${error && error.message ? error.message : String(error)}`,
          })
        }
      }

      /** Adopt a Host-provided state (e.g. after deleting an upload) and repaint. */
      function adopt(next) {
        snapshot = Object.assign({}, snapshot, {
          value: normalize(next, snapshot.value),
          load: 'ready',
        })
        revision = Date.now().toString(36)
        mediaKey = ''
        mediaDirty = false
        applyVisual()
        notify()
      }

      function reset() {
        revision = Date.now().toString(36)
        mediaKey = ''
        commit(normalize(DEFAULT_VALUE, DEFAULT_VALUE))
      }

      function noteMedia(kind, meta) {
        patchSnapshot({ media: kind, size: meta && meta.w > 0 ? { w: meta.w, h: meta.h } : null })
      }

      function setPlayback(playing) {
        if (layer === null) return
        const media = layer.querySelector('video')
        if (media === null) return
        if (playing) {
          const attempt = media.play()
          if (attempt && typeof attempt.catch === 'function') attempt.catch(() => undefined)
        } else {
          try {
            media.pause()
          } catch (error) {
            /* already paused */
          }
        }
      }

      function dispose() {
        if (saveTimer) {
          clearTimeout(saveTimer)
          saveTimer = null
        }
        disposeTokenLayer()
        removeLayer()
        document.documentElement.removeAttribute('data-dsh-bg')
        document.documentElement.removeAttribute('data-dsh-bg-kind')
        listeners.clear()
      }

      return {
        getSnapshot,
        subscribe,
        load,
        upload,
        reset,
        adopt,
        commit,
        dispose,
        noteMedia,
        noteError: (text) => patchSnapshot({ error: String(text) }),
        setPlayback,
        getMediaUrl: mediaUrl,
      }
    }

    /* ------------------------------------------------------------------ */
    /* page primitives (theme tokens only, no Harness Client imports)      */
    /* ------------------------------------------------------------------ */

    const TEXT_PRIMARY = 'var(--dsw-alias-label-primary)'
    const TEXT_SECONDARY = 'var(--dsw-alias-label-secondary)'
    const BORDER = 'var(--dsw-alias-border-l1)'
    const BRAND = 'var(--dsw-alias-brand-primary)'
    const RAISED = 'var(--dsw-alias-bg-layer-2)'

    function Section(props) {
      return h(
        'div',
        {
          style: {
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            gap: 4,
            padding: '14px 0',
            borderTop: `1px solid ${BORDER}`,
          },
        },
        h('div', { style: { fontSize: 13, fontWeight: 500, color: TEXT_PRIMARY } }, props.title),
        props.hint
          ? h('div', { style: { fontSize: 12, lineHeight: '18px', color: TEXT_SECONDARY } }, props.hint)
          : null,
        h('div', { style: { width: '100%', marginTop: 8 } }, props.children),
      )
    }

    function Switch(props) {
      const checked = props.checked === true
      return h(
        'button',
        {
          type: 'button',
          role: 'switch',
          'aria-checked': checked ? 'true' : 'false',
          'aria-label': props.label,
          onClick: () => props.onChange(!checked),
          disabled: props.disabled === true,
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            width: 42,
            height: 24,
            padding: 2,
            border: 0,
            borderRadius: 999,
            cursor: props.disabled ? 'default' : 'pointer',
            background: checked ? BRAND : 'var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,0.25))',
            transition: 'background 0.15s ease',
            justifyContent: checked ? 'flex-end' : 'flex-start',
            opacity: props.disabled ? 0.5 : 1,
          },
        },
        h('span', {
          style: {
            width: 20,
            height: 20,
            borderRadius: 999,
            background: 'var(--dsw-alias-switch-thumb, #fff)',
            boxShadow: '0 1px 2px rgba(0,0,0,0.25)',
            display: 'block',
          },
        }),
      )
    }

    function Segmented(props) {
      return h(
        'div',
        {
          style: {
            display: 'inline-flex',
            gap: 2,
            padding: 2,
            borderRadius: 10,
            background: 'var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,0.14))',
          },
        },
        props.options.map((option) =>
          h(
            'button',
            {
              key: option.value,
              type: 'button',
              'aria-pressed': props.value === option.value ? 'true' : 'false',
              onClick: () => props.onChange(option.value),
              style: {
                border: 0,
                borderRadius: 8,
                padding: '5px 12px',
                fontSize: 12,
                cursor: 'pointer',
                color: props.value === option.value ? TEXT_PRIMARY : TEXT_SECONDARY,
                background: props.value === option.value ? RAISED : 'transparent',
                fontWeight: props.value === option.value ? 600 : 400,
              },
            },
            option.label,
          ),
        ),
      )
    }

    function Slider(props) {
      const disabled = props.disabled === true
      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 4, padding: '6px 0', opacity: disabled ? 0.55 : 1 } },
        h(
          'div',
          { style: { display: 'flex', justifyContent: 'space-between', fontSize: 12, color: TEXT_SECONDARY } },
          h('span', null, props.label),
          h('span', { style: { color: disabled ? TEXT_SECONDARY : TEXT_PRIMARY, fontVariantNumeric: 'tabular-nums' } }, props.display),
        ),
        h('input', {
          type: 'range',
          min: props.min,
          max: props.max,
          step: 1,
          value: props.value,
          disabled: disabled,
          onChange: (event) => props.onChange(Number(event.target.value)),
          'aria-label': props.label,
          style: { width: '100%', accentColor: BRAND, cursor: disabled ? 'default' : 'pointer' },
        }),
      )
    }

    function Button(props) {
      return h(
        'button',
        {
          type: 'button',
          onClick: props.onClick,
          disabled: props.disabled === true,
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 12px',
            fontSize: 12,
            borderRadius: 8,
            cursor: props.disabled ? 'default' : 'pointer',
            color: props.primary ? '#fff' : TEXT_PRIMARY,
            background: props.primary ? BRAND : RAISED,
            border: `1px solid ${props.primary ? 'transparent' : BORDER}`,
            opacity: props.disabled ? 0.55 : 1,
          },
        },
        props.label,
      )
    }

    /* ------------------------------------------------------------------ */
    /* live preview: exactly the same geometry as the real layer            */
    /* ------------------------------------------------------------------ */

    function Preview(props) {
      const runtime = props.runtime
      const value = props.value
      const kind = props.kind
      const boxRef = React.useRef(null)
      const dragRef = React.useRef(null)
      const [, forceRender] = React.useState(0)

      const url = runtime.getMediaUrl()

      function beginDrag(event) {
        if (kind === 'none') return
        const box = boxRef.current
        if (box === null) return
        const rect = box.getBoundingClientRect()
        dragRef.current = {
          id: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          baseX: value.posX,
          baseY: value.posY,
          width: Math.max(1, rect.width),
          height: Math.max(1, rect.height),
          padX: geo.padX,
          padY: geo.padY,
        }
        box.setPointerCapture(event.pointerId)
        box.style.cursor = 'grabbing'
        forceRender((n) => n + 1)
      }

      function moveDrag(event) {
        const drag = dragRef.current
        if (drag === null || drag.id !== event.pointerId) return
        const dx = (event.clientX - drag.startX) / drag.width
        const dy = (event.clientY - drag.startY) / drag.height
        // One pixel of pointer travel moves the picture one pixel: the slide is
        // divided by the axis' overflow, not by the box.
        const stepX = drag.padX > 0.0001 ? (dx * 100) / drag.padX : 0
        const stepY = drag.padY > 0.0001 ? (dy * 100) / drag.padY : 0
        const nextX = clamp(Math.round(drag.baseX - stepX), 0, 100)
        const nextY = clamp(Math.round(drag.baseY - stepY), 0, 100)
        if (nextX === value.posX && nextY === value.posY) return
        runtime.commit(Object.assign({}, value, { posX: nextX, posY: nextY }))
      }

      function endDrag(event) {
        const drag = dragRef.current
        if (drag === null || drag.id !== event.pointerId) return
        dragRef.current = null
        const box = boxRef.current
        if (box !== null) {
          try {
            box.releasePointerCapture(event.pointerId)
          } catch (error) {
            /* the pointer may already be gone */
          }
          box.style.cursor = kind === 'none' ? 'default' : 'grab'
        }
        forceRender((n) => n + 1)
      }

      const geo = layout(value, props.size)
      const style = mediaStyle(value, props.size)
      const showFill = value.fit === 'contain' && value.fill !== false && kind !== 'none'
      const fillStyle = {
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        transform: 'scale(1.2)',
        filter: `blur(${Math.round(value.blur * 0.4 + 14)}px) brightness(0.92)`,
        pointerEvents: 'none',
      }

      const fillNode = showFill === false
        ? null
        : kind === 'video'
          ? h('video', {
            key: `fill-${url}`,
            src: url,
            muted: true,
            loop: true,
            autoPlay: true,
            playsInline: true,
            style: fillStyle,
          })
          : h('div', {
            style: Object.assign({}, fillStyle, {
              backgroundImage: `url("${url}")`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              backgroundRepeat: 'no-repeat',
            }),
          })

      const media = kind === 'none'
        ? null
        : kind === 'video'
          ? h('video', {
            key: url,
            src: url,
            muted: true,
            loop: true,
            autoPlay: true,
            playsInline: true,
            style: style,
            onLoadedMetadata: (event) => runtime.noteMedia('video', {
              w: event.target.videoWidth,
              h: event.target.videoHeight,
            }),
          })
          : h('img', {
            key: url,
            src: url,
            alt: '',
            style: style,
            onLoad: (event) => runtime.noteMedia('image', {
              w: event.target.naturalWidth,
              h: event.target.naturalHeight,
            }),
            onError: () => runtime.noteMedia('image', null),
          })

      return h(
        'div',
        {
          ref: boxRef,
          onPointerDown: beginDrag,
          onPointerMove: moveDrag,
          onPointerUp: endDrag,
          onPointerCancel: endDrag,
          style: {
            position: 'relative',
            width: '100%',
            aspectRatio: `${geo.viewW} / ${geo.viewH}`,
            overflow: 'hidden',
            borderRadius: 10,
            border: `1px solid ${BORDER}`,
            background: '#000',
            cursor: kind === 'none' ? 'default' : 'grab',
            touchAction: 'none',
          },
        },
        fillNode,
        media,
        h('div', {
          style: { position: 'absolute', inset: 0, background: tintColor(value.dim), pointerEvents: 'none' },
        }),
        h(
          'div',
          {
            style: {
              position: 'absolute',
              left: 8,
              bottom: 6,
              fontSize: 11,
              color: 'rgba(255,255,255,0.85)',
              textShadow: '0 1px 3px rgba(0,0,0,0.8)',
              pointerEvents: 'none',
            },
          },
          kind === 'none' ? '还没有选择背景' : `${kind === 'video' ? '视频' : '图片'} · 拖动可平移`,
        ),
      )
    }

    function statusLine(runtime) {
      const snapshot = runtime.getSnapshot()
      if (snapshot.error !== '') return { text: snapshot.error, color: 'var(--dsw-alias-state-error-primary)' }
      if (snapshot.load === 'loading') return { text: '正在读取设置…', color: TEXT_SECONDARY }
      if (snapshot.save === 'saving') return { text: '正在保存…', color: TEXT_SECONDARY }
      if (snapshot.save === 'saved') return { text: '已保存到本地（不联网）', color: TEXT_SECONDARY }
      return { text: '设置只保存在本机', color: TEXT_SECONDARY }
    }

    function WorkshopRow(props) {
      const item = props.item
      const active = props.active === true
      const streamable = item.kind === 'video' || item.kind === 'image'
      const usable = streamable || item.poster
      const posterNote = item.posterSize && item.posterSize.w > 0
        ? `预览 ${item.posterSize.w}×${item.posterSize.h}`
        : ''
      const badge = streamable
        ? item.kind === 'video' ? `视频 · 可播放${posterNote === '' ? '' : `（${posterNote}）`}` : '图片 · 可播放'
        : item.poster
          ? `${item.type === 'web' ? '网页' : '场景'} · 仅预览图${posterNote === '' ? '' : `（${posterNote}）`}`
          : `${item.type === 'web' ? '网页' : '场景'} · 不可用`
      const badgeColor = streamable
        ? 'var(--dsw-alias-state-success-primary)'
        : item.poster ? 'var(--dsw-alias-state-warn-primary)' : TEXT_SECONDARY

      return h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: 6,
            borderRadius: 10,
            border: `1px solid ${active ? BRAND : BORDER}`,
            background: RAISED,
          },
        },
        item.hasPoster
          ? h('img', {
            src: `${BASE}/workshop-poster?id=${encodeURIComponent(item.id)}`,
            alt: '',
            loading: 'lazy',
            style: {
              width: 96,
              height: 54,
              objectFit: 'cover',
              borderRadius: 6,
              flex: 'none',
              background: 'rgba(0,0,0,0.2)',
            },
          })
          : h('div', {
            style: {
              width: 96,
              height: 54,
              borderRadius: 6,
              flex: 'none',
              background: 'rgba(0,0,0,0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 10,
              color: TEXT_SECONDARY,
            },
          }, '无预览'),
        h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 } },
          h(
            'div',
            {
              style: {
                fontSize: 12,
                color: TEXT_PRIMARY,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              },
            },
            item.title,
          ),
          h('div', { style: { fontSize: 11, color: badgeColor } }, badge),
        ),
        h(Button, {
          label: usable === false ? '不可用' : streamable ? '用它' : '用预览图',
          disabled: usable === false,
          onClick: () => props.onPick(item),
        }),
      )
    }

    function BackgroundPage(props) {
      const runtime = props.runtime
      const [snapshot, setSnapshot] = React.useState(runtime.getSnapshot)
      const [files, setFiles] = React.useState([])
      const [pathDraft, setPathDraft] = React.useState('')
      const [workshop, setWorkshop] = React.useState(null)
      const [workshopScan, setWorkshopScan] = React.useState(0)
      const [filesScan, setFilesScan] = React.useState(0)
      const inputRef = React.useRef(null)

      React.useEffect(() => {
        let cancelled = false
        setWorkshop(null)
        fetch(`${BASE}/workshop`, { headers: { accept: 'application/json' } })
          .then((response) => (response.ok ? response.json() : null))
          .then((answer) => {
            if (cancelled) return
            if (answer === null) {
              setWorkshop({ items: [], roots: [] })
              return
            }
            setWorkshop({
              items: Array.isArray(answer.items) ? answer.items : [],
              roots: Array.isArray(answer.roots) ? answer.roots : [],
            })
          })
          .catch(() => {
            if (!cancelled) setWorkshop({ items: [], roots: [] })
          })
        return () => {
          cancelled = true
        }
      }, [workshopScan])

      React.useEffect(() => {
        const off = runtime.subscribe(() => setSnapshot(runtime.getSnapshot()))
        setPathDraft(runtime.getSnapshot().value.path)
        return off
      }, [runtime])

      React.useEffect(() => {
        let cancelled = false
        fetch(`${BASE}/files`, { headers: { accept: 'application/json' } })
          .then((response) => (response.ok ? response.json() : null))
          .then((answer) => {
            if (cancelled || !answer || !Array.isArray(answer.files)) return
            setFiles(answer.files)
          })
          .catch(() => undefined)
        return () => {
          cancelled = true
        }
      }, [snapshot.value.file, filesScan])

      const value = snapshot.value
      const status = statusLine(runtime)
      const kind = kindOf(value)
      const size = snapshot.size
      const range = layout(value, size)
      const playableWorkshop = workshop === null
        ? []
        : workshop.items.filter((item) => item.kind === 'video' || item.kind === 'image')
      const upscale = (() => {
        if (!size || size.w <= 0 || size.h <= 0) return 1
        const viewW = window.innerWidth
        const viewH = window.innerHeight
        const base = value.fit === 'contain'
          ? Math.min(viewW / size.w, viewH / size.h)
          : Math.max(viewW / size.w, viewH / size.h)
        return base * (value.zoom / 100)
      })()

      function update(patch, extra) {
        const current = runtime.getSnapshot().value
        runtime.commit(Object.assign({}, current, patch), extra)
      }

      async function pasteFromClipboard() {
        const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard
        if (!clipboard || typeof clipboard.read !== 'function') {
          runtime.noteError('这个浏览器不支持直接读剪贴板，请用「选择图片或视频…」')
          return
        }
        try {
          const items = await clipboard.read()
          for (const item of items) {
            const type = item.types.find((candidate) => candidate === 'image/png' || candidate === 'image/jpeg')
            if (type === undefined) continue
            const blob = await item.getType(type)
            const ext = type === 'image/png' ? '.png' : '.jpg'
            const file = new File([blob], `paste-${Date.now()}${ext}`, { type })
            await runtime.upload(file)
            return
          }
          runtime.noteError('剪贴板里没有图片 —— 先按 Win+Shift+S 截一张')
        } catch (error) {
          runtime.noteError(`读取剪贴板失败：${error && error.message ? error.message : String(error)}`)
        }
      }

      async function deleteUpload(name) {
        try {
          const response = await fetch(`${BASE}/delete?name=${encodeURIComponent(name)}`, { method: 'POST' })
          const answer = response.ok ? await response.json() : null
          if (answer !== null && answer.state) {
            runtime.adopt(answer.state)
          }
          setFilesScan((count) => count + 1)
          if (answer !== null && answer.stopped === true) {
            runtime.noteError('这张正在使用，已同时把背景关掉')
          }
        } catch (error) {
          runtime.noteError(`删除失败：${error && error.message ? error.message : String(error)}`)
        }
      }

      function deleteHistory(key) {
        const current = runtime.getSnapshot().value
        const history = current.history.filter((item) => item.key !== key)
        runtime.commit(Object.assign({}, current, { history }))
      }

      function restoreEntry(entry) {
        update(
          {
            enabled: true,
            source: entry.source,
            file: entry.file,
            path: entry.path,
            fit: entry.fit,
            zoom: entry.zoom,
            posX: entry.posX,
            posY: entry.posY,
          },
          { label: entry.label, poster: entry.poster },
        )
      }

      function pickFile(event) {
        const input = event.target
        const file = input.files && input.files[0]
        if (!file) return
        void runtime.upload(file)
        input.value = ''
      }

      function pickWorkshop(item) {
        const streamable = item.kind === 'video' || item.kind === 'image'
        const target = streamable ? item.media : item.poster
        if (!target) return
        update(
          {
            enabled: true,
            source: 'path',
            path: target,
            fit: 'cover',
            zoom: 100,
            posX: 50,
            posY: 50,
          },
          { label: item.title, poster: item.poster ?? '' },
        )
        setPathDraft(target)
      }

      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', padding: '0 2px 48px' } },
        h('div', { style: { paddingTop: 4 } },
          h('div', { style: { fontSize: 15, fontWeight: 600, color: TEXT_PRIMARY } }, '背景与毛玻璃'),
          h(
            'div',
            { style: { marginTop: 4, fontSize: 12, lineHeight: '18px', color: TEXT_SECONDARY } },
            '用主题令牌把界面变半透明。下面这块预览和实际效果同一套参数，可以直接拖动。',
          ),
        ),

        h(
          'div',
          {
            style: {
              position: 'sticky',
              top: 0,
              zIndex: 6,
              marginTop: 12,
              paddingTop: 6,
              paddingBottom: 8,
              background: 'var(--dsw-alias-bg-layer-2)',
              boxShadow: '0 10px 16px -14px rgba(0,0,0,0.5)',
            },
          },
          h(Preview, { runtime, value, kind, size }),
          h(
            'div',
            { style: { marginTop: 6, fontSize: 11, color: TEXT_SECONDARY } },
            size === null
              ? '预览占位；选择背景后这里会显示实际画面。'
              : `原始尺寸 ${size.w}×${size.h}　·　适配 ${value.fit === 'contain' ? '完整' : '铺满'}　·　缩放 ${value.zoom}%`,
          ),
          upscale > 1.3
            ? h(
              'div',
              { style: { marginTop: 2, fontSize: 11, color: 'var(--dsw-alias-state-warn-primary)' } },
              `当前放大约 ${upscale.toFixed(1)} 倍，画面会被拉糊 —— 换更大尺寸的原图，或用 Win+Shift+S 截图后点「粘贴截图」。`,
            )
            : null,
        ),

        h(
          Section,
          { title: '启用', hint: '关掉后令牌层会被移除，界面回到出厂配色。' },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 10 } },
            h(Switch, {
              checked: value.enabled,
              label: '启用毛玻璃背景',
              onChange: (next) => update({ enabled: next }),
            }),
            h('span', { style: { fontSize: 12, color: TEXT_SECONDARY } }, value.enabled ? '已开启' : '已关闭'),
          ),
        ),

        h(
          Section,
          { title: '背景来源', hint: kind === 'video' ? '当前是视频背景，循环播放；切到后台自动暂停省电。' : null },
          h(Segmented, {
            value: value.source,
            options: [
              { value: 'upload', label: '上传文件' },
              { value: 'path', label: '本机路径' },
            ],
            onChange: (next) => update({ source: next }),
          }),
          value.source === 'upload'
            ? h(
              'div',
              { style: { marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 } },
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
                h('input', {
                  ref: inputRef,
                  type: 'file',
                  accept: 'image/*,video/*',
                  onChange: pickFile,
                  style: { display: 'none' },
                }),
                h(Button, {
                  label: snapshot.save === 'saving' ? '处理中…' : '选择图片或视频…',
                  primary: true,
                  onClick: () => inputRef.current && inputRef.current.click(),
                }),                h(Button, {
                  label: '粘贴截图',
                  onClick: () => {
                    void pasteFromClipboard()
                  },
                }),
                h(
                  'span',
                  { style: { fontSize: 12, color: TEXT_SECONDARY, wordBreak: 'break-all' } },
                  value.file === '' ? '尚未选择文件' : `${value.file}${kind === 'video' ? '（视频）' : ''}`,
                ),
              ),
              files.length > 0
                ? h(
                  'div',
                  { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } },
                  files.slice(0, 8).map((entry) =>
                    h(
                      'div',
                      { key: entry.file, style: { position: 'relative', display: 'inline-flex' } },
                      h(
                        'button',
                        {
                          type: 'button',
                          title: entry.file,
                          onClick: () => update({ enabled: true, source: 'upload', file: entry.file }),
                          style: {
                            border: `1px solid ${entry.file === value.file ? BRAND : BORDER}`,
                            background: RAISED,
                            color: entry.file === value.file ? BRAND : TEXT_SECONDARY,
                            borderRadius: 8,
                            padding: '4px 22px 4px 8px',
                            fontSize: 11,
                            cursor: 'pointer',
                            maxWidth: 210,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          },
                        },
                        entry.file,
                      ),
                      h(
                        'button',
                        {
                          type: 'button',
                          title: '删除这个文件',
                          'aria-label': '删除这个文件',
                          onClick: (event) => {
                            event.stopPropagation()
                            void deleteUpload(entry.file)
                          },
                          style: {
                            position: 'absolute',
                            top: '50%',
                            right: 2,
                            transform: 'translateY(-50%)',
                            width: 16,
                            height: 16,
                            lineHeight: '12px',
                            padding: 0,
                            border: 0,
                            borderRadius: 8,
                            cursor: 'pointer',
                            fontSize: 11,
                            color: TEXT_PRIMARY,
                            background: 'rgba(0,0,0,0.35)',
                          },
                        },
                        '×',
                      ),
                    ),
                  ),
                )
                : null,
            )
            : h(
              'div',
              { style: { marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 } },
              h('input', {
                type: 'text',
                value: pathDraft,
                placeholder: 'D:\\壁纸\\晚霞.jpg   或   D:\\steam\\...\\8月26日 (1).mp4',
                spellCheck: false,
                onChange: (event) => setPathDraft(event.target.value),
                onBlur: () => update({ source: 'path', path: pathDraft, enabled: true }),
                onKeyDown: (event) => {
                  if (event.key === 'Enter') update({ source: 'path', path: pathDraft, enabled: true })
                },
                style: {
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '7px 10px',
                  fontSize: 12,
                  color: TEXT_PRIMARY,
                  background: RAISED,
                  border: `1px solid ${BORDER}`,
                  borderRadius: 8,
                },
              }),
              h(
                'span',
                { style: { fontSize: 11, color: TEXT_SECONDARY } },
                '只读取这一个文件，不移动、不复制、不上传。支持 jpg/png/webp/gif/mp4/webm/mkv/mov。',
              ),
            ),
        ),

        h(
          Section,
          {
            title: '最近使用',
            hint: value.history.length === 0
              ? '换过的背景会自动记录在这里（最多 12 条），找回来不用再翻文件夹。'
              : '点一下就换回去。',
          },
          value.history.length === 0
            ? null
            : h(
              'div',
              { style: { display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4, width: '100%' } },
              value.history.map((entry) =>
                h(
                  'div',
                  { key: entry.key, style: { position: 'relative', flex: 'none' } },
                  h(
                  'button',
                  {
                    type: 'button',
                    title: entry.label,
                    onClick: () => restoreEntry(entry),
                    style: {
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                      padding: 4,
                      width: 108,
                      cursor: 'pointer',
                      borderRadius: 8,
                      border: `1px solid ${entry.key === `${value.source}:${mediaName(value)}` ? BRAND : BORDER}`,
                      background: RAISED,
                      color: TEXT_SECONDARY,
                    },
                  },
                  h('img', {
                    src: `${BASE}/thumb?key=${encodeURIComponent(entry.key)}`,
                    alt: '',
                    loading: 'lazy',
                    onError: (event) => {
                      event.target.style.visibility = 'hidden'
                    },
                    style: { width: 98, height: 55, objectFit: 'cover', borderRadius: 6, background: 'rgba(0,0,0,0.2)' },
                  }),
                  h(
                    'span',
                    {
                      style: {
                        fontSize: 10,
                        lineHeight: '13px',
                        width: 98,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        textAlign: 'left',
                      },
                    },
                    `${entry.kind === 'video' ? '▶ ' : ''}${entry.label}`,
                  ),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      title: '从历史记录中删除',
                      'aria-label': '从历史记录中删除',
                      onClick: (event) => {
                        event.stopPropagation()
                        deleteHistory(entry.key)
                      },
                      style: {
                        position: 'absolute',
                        top: 2,
                        right: 2,
                        width: 18,
                        height: 18,
                        lineHeight: '14px',
                        padding: 0,
                        border: 0,
                        borderRadius: 9,
                        cursor: 'pointer',
                        fontSize: 12,
                        color: TEXT_PRIMARY,
                        background: 'rgba(0,0,0,0.45)',
                      },
                    },
                    '×',
                  ),
                ),
              ),
            ),
        ),

        h(
          Section,
          {
            title: '壁纸引擎（本机只读）',
            hint: workshop === null
              ? '正在扫描 Steam 工坊…'
              : playableWorkshop.length === 0
                ? `没有可直接播放的壁纸（扫描位置：${workshop.roots.length > 0 ? workshop.roots.join('、') : '未发现 Steam 库'}）。场景类画面请用 Win+Shift+S 截屏后点「粘贴截图」。`
                : `共 ${playableWorkshop.length} 张可直接播放。场景（Scene）类浏览器渲染不了、预览图又只有一两百像素，已不再列出。`,
          },
          playableWorkshop.length > 0
            ? h(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
              playableWorkshop.map((item) =>
                h(WorkshopRow, {
                  key: item.id,
                  item,
                  active: value.path === item.media || value.path === item.poster,
                  onPick: pickWorkshop,
                }),
              ),
            )
            : null,
          h(
            'div',
            { style: { marginTop: 8 } },
            h(Button, {
              label: workshop === null ? '扫描中…' : '重新扫描',
              disabled: workshop === null,
              onClick: () => setWorkshopScan((count) => count + 1),
            }),
          ),
        ),

        h(
          Section,
          {
            title: '画面适配',
            hint: '正方形或竖图用「完整」才看得到全貌；「铺满」按视口裁切。也可以直接在预览里拖动。',
          },
          h(Segmented, {
            value: value.fit,
            options: [
              { value: 'cover', label: '铺满（裁切）' },
              { value: 'contain', label: '完整（留边）' },
            ],
            onChange: (next) => update({ fit: next }),
          }),
          value.fit === 'contain'
            ? h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 } },
              h(Switch, {
                checked: value.fill !== false,
                label: '两侧模糊填充',
                onChange: (next) => update({ fill: next }),
              }),
              h(
                'span',
                { style: { fontSize: 12, color: TEXT_SECONDARY } },
                value.fill === false ? '两侧为纯黑底（会和中间形成明暗落差）' : '两侧用同一张图的模糊延伸（推荐，明暗连续）',
              ),
            )
            : null,
          h(Slider, {
            label: '缩放',
            display: `${value.zoom}%`,
            min: 50,
            max: 300,
            value: value.zoom,
            onChange: (next) => update({ zoom: next }),
          }),
          h(Slider, {
            label: '水平位置',
            display: range.rangeX ? `${value.posX}%` : '无余量',
            min: 0,
            max: 100,
            value: value.posX,
            disabled: range.rangeX === false,
            onChange: (next) => update({ posX: next }),
          }),
          h(Slider, {
            label: '垂直位置',
            display: range.rangeY ? `${value.posY}%` : '无余量',
            min: 0,
            max: 100,
            value: value.posY,
            disabled: range.rangeY === false,
            onChange: (next) => update({ posY: next }),
          }),
          range.rangeX && range.rangeY
            ? null
            : h(
              'div',
              { style: { fontSize: 11, lineHeight: '16px', color: TEXT_SECONDARY, marginTop: 2 } },
              `${range.rangeX ? '' : '水平'}${range.rangeX || range.rangeY ? '' : '和'}${range.rangeY ? '' : '垂直'}方向当前刚好贴合视口，没有可移动的余量；把「缩放」拉到 110% 以上就会松开。`,
            ),
          h(
            'div',
            { style: { display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' } },
            h(Button, {
              label: '居中并复位缩放',
              onClick: () => update({ zoom: 100, posX: 50, posY: 50 }),
            }),
          ),
        ),

        h(
          Section,
          { title: '毛玻璃强度' },
          h(Slider, {
            label: '面板不透明度',
            display: `${value.opacity}%`,
            min: 25,
            max: 98,
            value: value.opacity,
            onChange: (next) => update({ opacity: next }),
          }),
          h(Slider, {
            label: '背景模糊',
            display: `${value.blur} px`,
            min: 0,
            max: 60,
            value: value.blur,
            onChange: (next) => update({ blur: next }),
          }),
          h(Slider, {
            label: '背景明暗',
            display: value.dim > 0 ? `暗 ${value.dim}%` : value.dim < 0 ? `亮 ${-value.dim}%` : '原样',
            min: -50,
            max: 70,
            value: value.dim,
            onChange: (next) => update({ dim: next }),
          }),
        ),

        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 10, paddingTop: 14, borderTop: `1px solid ${BORDER}`, flexWrap: 'wrap' } },
          h(Button, { label: '恢复默认', onClick: () => runtime.reset() }),
          h(Button, { label: '关闭并还原界面', onClick: () => update({ enabled: false }) }),
        ),

        h(
          'div',
          { style: { marginTop: 12, fontSize: 12, color: status.color } },
          status.text,
        ),
        h(
          'div',
          {
            style: {
              marginTop: 4,
              fontSize: 11,
              color: TEXT_SECONDARY,
              fontVariantNumeric: 'tabular-nums',
              wordBreak: 'break-all',
            },
          },
          `图层 ${snapshot.layer}　·　媒体 ${mediaName(value) === '' ? '未选' : mediaName(value).split(/[\\/]/).pop()}　·　尺寸 ${size === null ? '未测到' : `${size.w}×${size.h}`}`,
        ),
      )
    }

    /* ------------------------------------------------------------------ */
    /* plugin                                                              */
    /* ------------------------------------------------------------------ */

    return {
      name: 'dsh-ui-background',
      inject: ['slots', 'theme'],
      apply(ctx) {
        const runtime = createRuntime(ctx)

        ctx.effect(() => {
          const tag = document.createElement('style')
          tag.id = STYLE_ID
          tag.textContent = CSS
          const host = document.head ?? document.documentElement
          host.appendChild(tag)

          const onVisibility = () => {
            runtime.setPlayback(document.visibilityState === 'visible')
          }
          document.addEventListener('visibilitychange', onVisibility)

          return () => {
            document.removeEventListener('visibilitychange', onVisibility)
            runtime.dispose()
            tag.remove()
          }
        })

        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            {
              name: 'settings.section',
              id: SECTION_ID,
              order: 30,
              label: () => '背景与玻璃',
            },
            (props) => h(BackgroundPage, Object.assign({}, props, { runtime })),
          ),
        )

        void runtime.load()
      },
    }
  },
})
