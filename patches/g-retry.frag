    /**
     * 通用超时 + 重试包装：runFn(signal) 返回结果对象；
     * 超时 abort 并重试 1 次，仍失败 → { failed: true, error }（调用方按 fail-safe 处理）。
     * judgeOnce / verifySimilarity 共用；rejection 在 race 内消化（防 unhandled rejection）。
     * 失败原因必须带回调用方（0.5.0 只返回 {failed:true}，用户看不到为什么判定器不可用）。
     */
    const withRetry = async (runFn, label) => {
      const timeoutMs = config.judgeTimeoutMs || 20000
      let lastError = null
      const runOnce = async () => {
        const controller = new AbortController()
        const timer = ctx.timeout(timeoutMs).then(() => {
          controller.abort(`dsh-approval-gate: ${label} 超时`)
          return 'timeout'
        })
        try {
          const call = runFn(controller.signal)
            .then((r) => ({ ...r, timedOut: false }))
            .catch((error) => ({ judgeError: error }))
          const result = await Promise.race([call, timer.then(() => ({ timedOut: true }))])
          if (result.judgeError) throw result.judgeError
          return result
        } finally {
          controller.abort(`dsh-approval-gate: ${label} 结束`)
        }
      }

      try {
        const first = await runOnce()
        if (!first.timedOut) return first
        lastError = new Error(`${label} 超时(${timeoutMs}ms)`)
        console.warn(`[${NAME}] ${label} 超时(${timeoutMs}ms)，重试 1 次`)
      } catch (error) {
        lastError = error
        console.error(`[${NAME}] ${label} 异常，重试 1 次`, error)
      }
      try {
        const second = await runOnce()
        if (!second.timedOut) return second
        lastError = lastError || new Error(`${label} 两次超时(${timeoutMs}ms×2)`)
      } catch (error) {
        lastError = error
        console.error(`[${NAME}] ${label} 重试仍异常`, error)
        return { failed: true, error: lastError }
      }
      console.warn(`[${NAME}] ${label} 两次超时(${timeoutMs}ms×2)`)
      return { failed: true, error: lastError }
    }

    /** flash 风险判定（带超时重试）：失败 → { verdict:'risky', category:'neutral', failed:true, judgeError }（fail-safe） */
    const judgeWithFlash = async (toolName, mode, justification) => {
      const result = await withRetry((signal) => judgeOnce(toolName, mode, justification, signal), 'flash 判断')
      if (result.failed) {
        const judgeError = describeError(result.error) || 'unknown'
        audit(`JUDGE   flash 判定不可用，转人工 | ${judgeError}`)
        return { verdict: 'risky', category: 'neutral', timedOut: true, failed: true, judgeError }
      }
      return result
    }

    /** 同类验证（带超时重试）：失败 → { verdict:'different', failed:true, judgeError }（fail-safe：验证失败按不同类处理） */
    const verifySimilarityWithRetry = async (toolName, mode, justification, samples) => {
      const result = await withRetry((signal) => verifySimilarity(toolName, mode, justification, samples, signal), '同类验证')
      if (result.failed) {
        const judgeError = describeError(result.error) || 'unknown'
        audit(`JUDGE   同类验证不可用，按不同类转人工 | ${judgeError}`)
        return { verdict: 'different', failed: true, judgeError }
      }
      return result
    }
