    // issue #8/#22：reasoningEffort: 'off' 在部分模型/宿主上不被接受，判定请求次次失败，
    // 表现为「所有请求都转人工」。首次判定为不支持时改走「不传 effort」，并记住该路由。
    let reasoningEffortUnsupported = false

    const isEffortUnsupported = (error) => {
      const text = String((error && (error.message || error)) || '')
      if (!/effort|reasoning/i.test(text)) return false
      return /unsupported|not[\s_-]?support|invalid|unknown|unrecognized|不支持|无效/i.test(text)
    }

    /**
     * 底层 flash 调用：流式请求并累积文本输出（可取消）。
     * 只累积 text-delta：reasoning-delta 是模型的思考过程，不参与 SAFE/RISKY 协议解析（issue #20）。
     * @returns {Promise<string>} 模型输出的文本
     */
    const streamFlashOnce = async (userText, systemPrompt, signal) => {
      const { provider, model } = resolveJudgeModel()
      const options = {
        provider,
        model,
        messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }],
        system: systemPrompt,
        temperature: 0,
        // 256：结论仅几个词，但模型偶发先输出复述/思考文本，64 会被截断导致解析失败
        maxTokens: 256,
        signal
      }
      if (!reasoningEffortUnsupported) options.reasoningEffort = 'off'

      let text = ''
      for await (const chunk of llm.stream(options)) {
        if (chunk.type === 'text-delta') {
          text += chunk.text
        } else if (chunk.type === 'finish') {
          // chunk.reason 在部分宿主版本上是可选的（issue #10：直接读 chunk.reason.kind 会 TypeError）
          const reason = chunk.reason || {}
          if (reason.kind === 'error' || reason.kind === 'aborted') {
            const failure = reason.failure && reason.failure.message ? reason.failure.message : reason.kind
            const error = new Error('flash 调用失败: ' + failure)
            error.judgeFailureKind = reason.kind
            throw error
          }
        }
      }
      return text
    }

    const callFlash = async (userText, systemPrompt, signal) => {
      if (reasoningEffortUnsupported) return streamFlashOnce(userText, systemPrompt, signal)
      try {
        return await streamFlashOnce(userText, systemPrompt, signal)
      } catch (error) {
        if (!isEffortUnsupported(error)) throw error
        reasoningEffortUnsupported = true
        audit(`CONFIG  reasoningEffort=off 不被当前模型支持 → 判定请求改为不传 effort | ${String((error && error.message) || error).slice(0, 160)}`)
        return streamFlashOnce(userText, systemPrompt, signal)
      }
    }
