/**
 * architect 预设模板 × dsh 运行时兼容回归（2026-09-16 事故防复发）。
 *
 * 事故：dsh 0.1.6-alpha.1 移除 @deepseek-ai/dsh-workflow-worker-thread，
 * 模板里 delegation 组的旧行让每次新鲜物化（新机器/容器/版本戳变更）都
 * 产出一份挂载必失败的预设。上游 agent-presets 对"行引用不可解析的包"
 * 的判定是整份组合拒绝挂载——一行坏，全预设死。
 *
 * 这组用例在 CI（无 dsh 树）也能跑：只做模板静态断言；跨包存在性由
 * scripts/check-compat.mjs 在装有 dsh 的机器上审计。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const template = readFileSync(join(here, '../presets/architect/agent.cordis.yml'), 'utf8')

describe('architect 预设模板 × 运行时兼容', () => {
  it('不引用已移除的 workflow-worker-thread 引擎包（2026-09-16 事故回归）', () => {
    expect(template).not.toContain('dsh-workflow-worker-thread')
  })

  it('工作流行使用 0.1.6 的 workflow-ptc 引擎包', () => {
    expect(template).toContain("'@deepseek-ai/dsh-workflow-ptc'")
  })

  it('携带 0.1.6 shipped standard 基线的 present 行', () => {
    expect(template).toContain("- id: present")
    expect(template).toContain("'@deepseek-ai/dsh-tool-present'")
  })

  it('persona 使用 prefix 字段（0.1.5-alpha.1 起必填，text 已废弃）', () => {
    expect(template).toMatch(/- id: persona[\s\S]*?prefix:/)
  })
})
