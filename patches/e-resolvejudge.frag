    const BUILTIN_JUDGE_MODEL = { provider: 'deepseek-official', model: 'deepseek-v4-flash' }

    /**
     * 判定模型解析：allowlist.json 的 judgeModel（"provider/model"）> agent 默认模型 > 内置 flash。
     * issue #8/#22：内置 flash 在部分部署下不可用，判定请求必然失败，用户无法自行换模型。
     * @returns {{provider:string, model:string, source:'config'|'agent-default'|'builtin'}}
     */
    const resolveJudgeModel = () => {
      const pinned = typeof config.judgeModel === 'string' ? config.judgeModel.trim() : ''
      if (pinned) {
        const slash = pinned.indexOf('/')
        if (slash > 0 && slash < pinned.length - 1) {
          return { provider: pinned.slice(0, slash), model: pinned.slice(slash + 1), source: 'config' }
        }
      }
      try {
        const sel = agentDefaultModel && typeof agentDefaultModel.currentSelection === 'function'
          ? agentDefaultModel.currentSelection()
          : undefined
        if (sel && typeof sel.provider === 'string' && sel.provider && typeof sel.model === 'string' && sel.model) {
          return { provider: sel.provider, model: sel.model, source: 'agent-default' }
        }
      } catch (error) {
        console.error(`[${NAME}] agentDefaultModel.currentSelection() failed`, error)
      }
      return { provider: BUILTIN_JUDGE_MODEL.provider, model: BUILTIN_JUDGE_MODEL.model, source: 'builtin' }
    }

    const resolveModel = resolveJudgeModel
