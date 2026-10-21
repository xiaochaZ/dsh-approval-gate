// client.js 改造：判定模型可配（issue #8/#22）+ 初始化卡片显示实际写入路径与歧义提示
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const p = join(here, 'client.js')
let src = readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const done = []

function once(label, oldText, newText) {
  const parts = src.split(oldText)
  if (parts.length !== 2) throw new Error(`[${label}] 锚点命中 ${parts.length - 1} 次`)
  src = parts[0] + newText + parts[1]
  done.push(label)
}

// 1. 状态：判定模型输入框
once(
  'state',
  "      const [timeoutMs, setTimeoutMs] = React.useState('20000')\n",
  "      const [timeoutMs, setTimeoutMs] = React.useState('20000')\n      const [judgeModel, setJudgeModel] = React.useState('')\n"
)

// 2. 载入时同步配置值
once(
  'load',
  "              setTimeoutMs(String(data.config.judgeTimeoutMs))\n",
  "              setTimeoutMs(String(data.config.judgeTimeoutMs))\n              setJudgeModel(String(data.config.judgeModel || ''))\n"
)

// 3. 初始化卡片：显示实际路径 + 歧义/错误提示
once(
  'setup-card',
  "              (setup.configured ? '当前已配置 ✓' : '当前未检测到，可一键写入。'))),",
  "              (setup.configured ? '当前已配置 ✓' : '当前未检测到，可一键写入。') +\n              (setup.patchPath ? ' 目标文件：' + setup.patchPath : '') +\n              (setup.ambiguous && setup.hint ? ' ⚠ ' + setup.hint : '') +\n              (setup.error ? ' 读取失败：' + setup.error : ''))),"
)

// 4. 新增「判定模型」卡片（插在初始化卡片之后）
once(
  'judge-model-card',
  "        // ---- 管道总览 ----\n",
  `        // ---- 判定模型（issue #8/#22：内置 flash 不可用时必须能换模型） ----
        React.createElement('div', { className: 'ag-set-card' },
          React.createElement('div', { className: 'ag-set-card-head' },
            React.createElement('div', { className: 'ag-set-card-title' }, '判定模型'),
            React.createElement('p', { className: 'ag-set-card-sub' },
              '沙箱越界时用来判定 SAFE/RISKY 的模型。留空 = 跟随当前 agent 默认模型，两者都不可用时回退内置 deepseek-v4-flash（判定失败会转人工并在审计里留下 judgeError）。')), 
          React.createElement('div', { className: 'ag-set-row' },
            React.createElement('input', {
              className: 'ag-set-input',
              value: judgeModel,
              placeholder: 'provider/model，如 deepseek-official/deepseek-v4-flash',
              onChange: function (e) { setJudgeModel(e.target.value) },
              onKeyDown: function (e) { if (e.key === 'Enter') api({ op: 'set', kind: 'judgeModel', value: judgeModel.trim() }) },
            }),
            React.createElement('button', {
              type: 'button', className: 'ag-set-btn', disabled: busy,
              onClick: function () { api({ op: 'set', kind: 'judgeModel', value: judgeModel.trim() }) },
            }, '保存'),
            judgeModel
              ? React.createElement('button', {
                  type: 'button', className: 'ag-set-btn', disabled: busy,
                  onClick: function () { setJudgeModel(''); api({ op: 'set', kind: 'judgeModel', value: '' }) },
                }, '恢复默认')
              : React.createElement('span', { className: 'ag-set-note' }, '跟随 agent 默认模型'),
          ),
        ),

        // ---- 管道总览 ----
`
)

writeFileSync(p, src, 'utf8')
console.log('applied: ' + done.join(', '))
