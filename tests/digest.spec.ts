import { describe, expect, it } from 'vitest'
import { checkDigest, type DigestInput } from '../src/digest.ts'

function goodInput(): DigestInput {
  return {
    requirement: '为分身建知识库体系与流程 SKILL',
    doItems: ['建五类结构知识库', '写三个 SKILL', '方案模板'],
    dontItems: ['不写插件', '不做 RAG'],
    toConfirm: ['阶段 3 拍板'],
    assumptions: ['宿主 skill-filesystem 正常（依据：alpha.2 实测）'],
    blockers: [],
    systems: ['digital-architect', 'DSH_HOME/skills'],
    evidences: [
      { conclusion: 'SKILL 发现根含 DSH_HOME/skills', source: 'dsh-skill-filesystem README §根目录' },
      { conclusion: '宪章知识定位边界', source: 'suite-charter.md §0' },
    ],
    risksChecked: true,
    validationPlan: 'frontmatter 静态检查 + 挂载发现验证 + 流水线走查',
  }
}

describe('checkDigest', () => {
  it('六项覆盖齐全 → 通过', () => {
    const r = checkDigest(goodInput())
    expect(r.admission).toBe('通过')
    expect(r.missing).toEqual([])
    expect(r.coverage).toHaveLength(6)
    expect(r.coverage.every(c => c.ok)).toBe(true)
  })

  it('阻断项非空 → 不通过（但 missing 不含阻断项本身，走专项处理）', () => {
    const r = checkDigest({ ...goodInput(), blockers: ['依赖未确认的宿主升级'] })
    expect(r.admission).toBe('不通过')
    expect(r.coverage.find(c => c.item.includes('⑥'))?.ok).toBe(true)
  })

  it('缺「做」条目 → 不通过并指出补齐项', () => {
    const r = checkDigest({ ...goodInput(), doItems: [] })
    expect(r.admission).toBe('不通过')
    expect(r.missing.some(m => m.includes('做'))).toBe(true)
    expect(r.coverage.find(c => c.item.includes('①'))?.ok).toBe(false)
  })

  it('证据缺来源 → 不通过', () => {
    const r = checkDigest({ ...goodInput(), evidences: [{ conclusion: '某结论', source: '' }] })
    expect(r.admission).toBe('不通过')
    expect(r.missing.some(m => m.includes('证据来源'))).toBe(true)
  })

  it('风险未检查 / 验证计划为空 → 均不通过', () => {
    expect(checkDigest({ ...goodInput(), risksChecked: false }).admission).toBe('不通过')
    expect(checkDigest({ ...goodInput(), validationPlan: '  ' }).admission).toBe('不通过')
  })

  it('畸形输入不抛错（字段缺失按空处理）', () => {
    const r = checkDigest({ requirement: 'x', doItems: ['y'], validationPlan: 'z', risksChecked: true } as unknown as DigestInput)
    expect(r.admission).toBe('不通过')
    expect(r.coverage.find(c => c.item.includes('③'))?.ok).toBe(false)
  })
})
