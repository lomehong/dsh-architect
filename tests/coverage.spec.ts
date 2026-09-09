import { describe, expect, it } from 'vitest'
import { checkDesign, countEmptyCells, countUnfilledPlaceholders, renderReviewSkeleton, sectionOf } from '../src/coverage.ts'

/** 构造一个达标方案（六章节齐 + 表格无空格 + 五问全答）。 */
function goodDesign(): string {
  return [
    '# 可执行技术方案：测试方案',
    '',
    '## 0. 一句话与五问速答',
    '',
    '| 五问 | 速答 |',
    '|---|---|',
    '| 改哪里？ | 仅本仓库 |',
    '| 为什么改？ | 自举验证流程 |',
    '| 影响谁？ | 分身会话新增技能 |',
    '| 如何验证？ | 静态检查与挂载验证 |',
    '| 还有什么没有确认？ | 两项挂起待主人 |',
    '',
    '## 1. 需求覆盖（10 分）',
    '',
    '| # | 条目 | 响应 |',
    '|---|---|---|',
    '| 1 | 知识库 | 已建 |',
    '',
    '## 2. 系统覆盖（9 分）',
    '',
    '| 系统 | 变更 |',
    '|---|---|',
    '| 本仓库 | 新增 |',
    '',
    '## 3. 证据覆盖（10 分）',
    '',
    '| 结论 | 出处 |',
    '|---|---|',
    '| A | 宪章 §0 |',
    '',
    '## 4. 风险覆盖（9 分）',
    '',
    '| 风险 | 对策 |',
    '|---|---|',
    '| 兼容 | 不涉及 |',
    '',
    '## 5. 验证覆盖（9 分）',
    '',
    '| 手段 | 内容 |',
    '|---|---|',
    '| 静态 | 校验脚本 |',
    '',
    '## 6. 不确定性治理（10 分）',
    '',
    '| # | 类型 | 处置 |',
    '|---|---|---|',
    '| 1 | Human Decision | 挂起 |',
  ].join('\n')
}

describe('checkDesign', () => {
  it('达标方案满分通过', () => {
    const r = checkDesign(goodDesign())
    expect(r.total).toBe(60)
    expect(r.pass).toBe(true)
    expect(r.fiveQuestions.answered).toBe(5)
    expect(r.issues).toEqual([])
    expect(r.dimensions.every(d => d.found && d.score === 10)).toBe(true)
  })

  it('空输入不抛错、零分不通过', () => {
    const r = checkDesign('')
    expect(r.total).toBe(0)
    expect(r.pass).toBe(false)
    expect(r.dimensions).toHaveLength(6)
    expect(r.issues.length).toBeGreaterThan(0)
  })

  it('缺失两个维度得 50 分以下且不通过', () => {
    const md = goodDesign()
      .replace(/## 3\. 证据覆盖[\s\S]*?(?=## 4\.)/, '')
      .replace(/## 4\. 风险覆盖[\s\S]*?(?=## 5\.)/, '')
    const r = checkDesign(md)
    expect(r.dimensions.find(d => d.key === 'evidence')?.found).toBe(false)
    expect(r.dimensions.find(d => d.key === 'risk')?.score).toBe(0)
    expect(r.pass).toBe(false)
    expect(r.issues.some(i => i.includes('证据覆盖'))).toBe(true)
  })

  it('空表格单元格被检出并扣分', () => {
    const md = goodDesign().replace('| 兼容 | 不涉及 |', '| 兼容 | |')
    const r = checkDesign(md)
    const risk = r.dimensions.find(d => d.key === 'risk')
    expect(risk?.emptyCells).toBeGreaterThan(0)
    expect(risk?.score).toBe(7)
    expect(r.pass).toBe(true) // 57 分仍过线，但 issue 已登记
    expect(r.issues.some(i => i.includes('空表格单元格'))).toBe(true)
  })

  it('未填写占位符被检出并扣分', () => {
    const md = goodDesign().replace('| 1 | 知识库 | 已建 |', '| 1 | <待填写条目> | 已建 |')
    const r = checkDesign(md)
    expect(r.issues.some(i => i.includes('占位符'))).toBe(true)
    expect(r.dimensions.find(d => d.key === 'requirement')?.score).toBe(7)
  })

  it('五问缺答阻断通过', () => {
    const md = goodDesign().replace('| 如何验证？ | 静态检查与挂载验证 |', '| 如何验证？ |  |')
    const r = checkDesign(md)
    expect(r.fiveQuestions.answered).toBeLessThan(5)
    expect(r.pass).toBe(false)
  })
})

describe('解析工具函数', () => {
  it('sectionOf 截取到下一个同级标题', () => {
    const sec = sectionOf(goodDesign(), '风险覆盖')
    expect(sec).toContain('| 兼容 | 不涉及 |')
    expect(sec).not.toContain('验证覆盖')
  })

  it('countEmptyCells 排除表头分隔行', () => {
    expect(countEmptyCells('| a | b |\n|---|---|\n| 1 | 2 |')).toBe(0)
    expect(countEmptyCells('| a | b |\n|---|---|\n| 1 | |')).toBe(1)
  })

  it('countUnfilledPlaceholders 只认中文占位形态', () => {
    expect(countUnfilledPlaceholders('标题 <方案标题> 待填')).toBe(1)
    expect(countUnfilledPlaceholders('泛型 Array<string> 与比较 a<b 与 <b>粗体</b>')).toBe(0)
  })
})

describe('renderReviewSkeleton', () => {
  it('骨架含标题、合计与验收纪律提示', () => {
    const skeleton = renderReviewSkeleton('测试方案', checkDesign(goodDesign()))
    expect(skeleton).toContain('# 评审结论：测试方案')
    expect(skeleton).toContain('60/60')
    expect(skeleton).toContain('待主人确认')
  })
})
