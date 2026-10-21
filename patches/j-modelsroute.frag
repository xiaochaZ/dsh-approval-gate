        offModelsRoute = registerRoute({
          kind: 'exact',
          path: '/api/auto-approve/models',
          handler: async (req, res) => {
            const send = (code, obj) => {
              res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' })
              res.end(JSON.stringify(obj))
            }
            try {
              if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, { ok: false, error: 'method not allowed' })
              const current = resolveJudgeModel()
              let providers = null
              let error = ''
              try {
                if (llm && typeof llm.listProviders === 'function') providers = await llm.listProviders()
                else if (llm && typeof llm.listModels === 'function') providers = await llm.listModels()
              } catch (e) {
                error = String((e && e.message) || e)
              }
              return send(200, { ok: true, current, providers, error })
            } catch (e) {
              send(400, { ok: false, error: String((e && e.message) || e) })
            }
          },
        })
