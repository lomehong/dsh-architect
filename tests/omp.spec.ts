import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:node:fs'
import { fileURLToPath } from 'node:node:url'
import factory, { createTools, type OmpApi, type ZodLike } from '../src/omp.ts'

/** 复用达标方案骨架（与 coverage/tools 测试同一 fixture）。 */
function goodDesign(): string {
  return readFileSync(fileURLToPath(new URL('./fixture-design.md', import.meta.url)), 'utf8')
}

/** 最小 zod 兼容 stub：只为让 schema 构建不抛错，execute 不依赖 schema。 */
function stubZod(): ZodLike {
  const scalar = () => ({ optional: () => ({}) })
  return {
    object: fields => ({ fields }),
    string: scalar,
    boolean: scalar,
    array: () => ({ optional: () => ({}) }),
  }
}

function apiWith(partial: Partial<OmpApi>): OmpApi {
  return { logger: { warn: () => {}, info: () => {} }, ...partial }
}

describe('omp 工厂：zod builder 解析与降级', () => {
  it('api.zod 命中：注册三个工具（名字与 dsh 版一致）', () => {
    const tools = createTools(apiWith({ zod: stubZod() }))
    expect(tools.map(t => t.name)).toEqual(['architect_digest', 'architect_design', 'architect_review', 'architect_lint'])
    for (const t of tools) {
      expect(t.loadMode).toBe('essential')
      expect(t.parameters).toBeDefined()
      expect(typeof t.execute).toBe('function')
      expect(t.description.length).toBeGreaterThan(10)
    }
  })

  it('回退链：api.pi.zod 命中', () => {
    const tools = createTools(apiWith({ pi: { zod: stubZod() } }))
    expect(tools).toHaveLength(4)
  })

  it('builder 全缺：factory 降级为空数组并告警，不抛错', () => {
    const warns: string[] = []
    const tools = factory(apiWith({ logger: { warn: m => { warns.push(String(m)) } } }))
    expect(tools).toEqual([])
    expect(warns.some(w => w.includes('工具注册失败'))).toBe(true)
  })
})

describe('omp 三工具执行语义（与 dsh 版一致）', () => {
  it('architect_digest：达标输入 → 通过 + content 含通过文案', async () => {
    const [tool] = createTools(apiWith({ zod: stubZod() }))
    const result = await tool.execute('t1', {
      requirement: 'r', do_items: ['a'], dont_items: ['b'], systems: ['s'],
      evidences: [{ conclusion: 'c', source: 'src' }], risks_checked: true, validation_plan: 'v',
    })
    expect(result.details.admission).toBe('通过')
    expect(result.content[0]?.text).toContain('通过')
  })

  it('architect_digest：缺 do_items → 报错文案与 dsh 版一致', async () => {
    const [tool] = createTools(apiWith({ zod: stubZod() }))
    await expect(tool.execute('t1', { requirement: 'r' })).rejects.toThrow(/do_items 必填/)
  })

  it('architect_design：达标方案 → 60/60 通过', async () => {
    const tools = createTools(apiWith({ zod: stubZod() }))
    const tool = tools.find(t => t.name === 'architect_design')!
    const result = await tool.execute('t1', { design_md: goodDesign() })
    expect(result.details.total).toBe(60)
    expect(result.details.pass).toBe(true)
    expect(result.content[0]?.text).toContain('自检通过：60/60')
  })

  it('architect_design：空方案 → 报错必填', async () => {
    const tools = createTools(apiWith({ zod: stubZod() }))
    const tool = tools.find(t => t.name === 'architect_design')!
    await expect(tool.execute('t1', { design_md: '   ' })).rejects.toThrow(/design_md 必填/)
  })

  it('architect_review：产出评审骨架且 render 文案强调自报 ≠ 完成', async () => {
    const tools = createTools(apiWith({ zod: stubZod() }))
    const tool = tools.find(t => t.name === 'architect_review')!
    const result = await tool.execute('t1', { design_md: goodDesign(), title: 'omp 自检' })
    expect(result.details.pass).toBe(true)
    expect(String(result.details.review_md)).toContain('# 评审结论：omp 自检')
    expect(result.content[0]?.text).toContain('自报 ≠ 完成')
  })
})
