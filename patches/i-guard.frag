    // ---- 路由访问守卫（issue #12：0.5.0 的 /api/auto-approve/* 没有任何校验，
    //      任意本机进程或网页都能读取审计轨迹、改规则、清快照）----
    function isLoopbackAddress(addr) {
      const a = String(addr || '')
      return a === '::1' || a.startsWith('127.') || a === '::ffff:127.0.0.1'
    }

    /** 只放行本机回环 + 同源请求；需要远程访问时在 allowlist.json 设 apiAllowAddresses */
    const apiGuard = (handler) => async (req, res) => {
      const reject = (code, why) => {
        try { audit(`DENIED  api ${String(req.method || '')} ${String(req.url || '').slice(0, 120)} reason=${why}`) } catch { /* 忽略 */ }
        if (!res.headersSent) {
          res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, error: why }))
        }
      }
      try {
        const allowRemote = Array.isArray(config.apiAllowAddresses) ? config.apiAllowAddresses.map((v) => String(v)) : []
        const remote = (req.socket && (req.socket.remoteAddress || '')) || ''
        if (!isLoopbackAddress(remote) && !allowRemote.includes(remote)) {
          return reject(403, 'non-loopback client rejected (set apiAllowAddresses to allow)')
        }
        if (String(req.headers['sec-fetch-site'] || '') === 'cross-site') {
          return reject(403, 'cross-site request rejected')
        }
        const origin = req.headers.origin
        if (origin) {
          let sameOrigin = false
          try {
            sameOrigin = new URL(origin).host === String(req.headers.host || '')
          } catch { sameOrigin = false }
          if (!sameOrigin) return reject(403, 'cross-origin request rejected')
        }
        return await handler(req, res)
      } catch (error) {
        if (!res.headersSent) {
          res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, error: String((error && error.message) || error) }))
        }
      }
    }

    const registerRoute = (options) => ctx.webServer.register(Object.assign({}, options, { handler: apiGuard(options.handler) }))
