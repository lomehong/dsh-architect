import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { apply as toolsApply, name as toolsName } from '../src/tools.ts'
import { apply as indexApply } from '../src/index.ts'

interface CapturedTool {
  name: string
  description: string
  parameters: { type: 'object'; additionalProperties?: boolean; required?: string[]; properties: Record<string, unknown> }
  output: { schema: { type: 'object'; additionalProperties?: boolean; properties: Record<string, unknown> }; render: (args: unknown, value: unknown) => Array<{ type: 'text'; text: string }> }
  execute: (args: unknown, exec?: unknown) => Promise<unknown>
}

/** 复用达标方案骨架（fixture 与 coverage 测试的构造规则一致）。 */
function goodDesign(): string {
  return readFileSync(fileURLToPath(new URL('./fixture-design.md', import.meta.url)), 'utf8')
}

function capture(): CapturedTool[] {
  const registered: CapturedTool[] = []
  toolsApply({ tools: { register(t: CapturedTool) { registered.push(t) } } } as never)
  return registered
}

const tools = (): Record<string, CapturedTool> => Object.fromEntries(capture().map(t => [t.name, t]))

describe('tools 入口注册形态', () => {
  it('注册 architect_digest / architect_design / architect_review', () => {
    const registered = capture()
    expect(registered.map(t => t.name)).toEqual(['architect_digest', 'architect_design', 'architect_review', 'architect_lint'])
    expect(toolsName).toBe('tool-architect')
    for (const t of registered) {
      expect(t.parameters.type).toBe('object')
      expect(t.parameters.additionalProperties).toBe(false)
      expect(t.output.schema.type).toBe('object')
      expect(typeof t.execute).toBe('function')
    }
  })

  it('ctx.tools 缺席时静默跳过（显式降级：不抛错）', () => {
    expect(() => toolsApply({} as never)).not.toThrow()
    expect(() => toolsApply({ get: () => undefined } as never)).not.toThrow()
  })
})

describe('三个工具', () => {
  it('输出键 ⊆ output schema（宪章⑬：宿主按 additionalProperties:false 拒多余键）', async () => {
    const t = tools()
    for (const tool of [t.architect_digest, t.architect_design, t.architect_review]) {
      const args = tool.name === 'architect_digest'
        ? { requirement: 'r', do_items: ['a'], validation_plan: 'v', risks_checked: true, evidences: [{ conclusion: 'c', source: 's' }] }
        : tool.name === 'architect_design'
          ? { design_md: goodDesign() }
          : { design_md: goodDesign(), title: 'T' }
      const value = (await tool.execute(args)) as Record<string, unknown>
      const allowed = Object.keys(tool.output.schema.properties)
      for (const key of Object.keys(value)) {
        expect(allowed, `${tool.name} 返回键 ${key} 必须在 output schema 内`).toContain(key)
      }
    }
  })

  it('architect_digest：达标输入 → 通过 + render 含通过文案', async () => {
    const t = tools()
    const value = (await t.architect_digest.execute({
      requirement: 'r', do_items: ['a'], dont_items: ['b'], systems: ['s'],
      evidences: [{ conclusion: 'c', source: 'src' }], risks_checked: true, validation_plan: 'v',
    })) as { admission: string; coverage_text: string }
    expect(value.admission).toBe('通过')
    const [text] = t.architect_digest.output.render({}, value)
    expect(text.text).toContain('通过')
  })

  it('architect_design：必填校验与评分输出', async () => {
    const t = tools()
    await expect(t.architect_design.execute({ design_md: '   ' })).rejects.toThrow(/design_md 必填/)
    const value = (await t.architect_design.execute({ design_md: goodDesign() })) as { total: number; pass: boolean }
    expect(value.total).toBe(60)
    expect(value.pass).toBe(true)
  })

  it('architect_review：产出评审骨架且 render 说明自报 ≠ 完成', async () => {
    const t = tools()
    const value = (await t.architect_review.execute({ design_md: goodDesign(), title: '自举方案' })) as { review_md: string; pass: boolean }
    expect(value.pass).toBe(true)
    expect(value.review_md).toContain('# 评审结论：自举方案')
    const [text] = t.architect_review.output.render({}, value)
    expect(text.text).toContain('自报 ≠ 完成')
  })
})

describe('主入口', () => {
  it('provide 服务并可用（DSH_HOME 隔离：物化副作用落在临时目录）', () => {
    const tmpHome = mkdtempSync(join(tmpdir(), 'dsh-architect-home-'))
    process.env.DSH_HOME = tmpHome
    try {
      const provided: Record<string, unknown> = {}
      indexApply({ provide: (n: string, v: unknown) => { provided[n] = v }, logger: { info: () => {}, warn: () => {} } } as never)
      const service = provided['dsh-architect'] as { checkDesign: (md: string) => { total: number }; version: string }
      expect(service.version).toBe('0.3.0')
      expect(service.checkDesign('# x').total).toBe(0)
      // 物化副作用应落在隔离 home（architect preset 两文件 + 版本戳）
      expect(existsSync(join(tmpHome, '.agent-presets', 'architect', 'agent.cordis.yml'))).toBe(true)
      expect(existsSync(join(tmpHome, '.agent-presets', 'architect', '.materialized-version'))).toBe(true)
    } finally {
      rmSync(tmpHome, { recursive: true, force: true })
      delete process.env.DSH_HOME
    }
  })

  it('ctx.provide 缺席时告警不抛错（DSH_HOME 隔离）', () => {
    const tmpHome = mkdtempSync(join(tmpdir(), 'dsh-architect-home-'))
    process.env.DSH_HOME = tmpHome
    try {
      expect(() => indexApply({} as never)).not.toThrow()
      expect(existsSync(join(tmpHome, '.agent-presets', 'architect', 'agent.cordis.yml'))).toBe(true)
    } finally {
      rmSync(tmpHome, { recursive: true, force: true })
      delete process.env.DSH_HOME
    }
  })
})
