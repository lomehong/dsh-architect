/**
 * dsh-architect 插件入口（宿主端）。
 *
 * 提供 'dsh-architect' 服务：架构师职能的确定性检查器（需求准入六项覆盖 /
 * 方案六维度+五问覆盖检查与评分 / 评审骨架渲染）。模型工具入口见 ./tools.ts
 * （preset 行 `@dsh-extra/dsh-architect/tools`）。
 *
 * 纪律（套件宪章）：
 * - 零套件依赖（不 import 任何 @dsh-extra/*；对宿主服务的注入不受限）；
 * - 纯函数核心（coverage.ts/digest.ts）不落盘、不联网——本插件无数据目录，
 *   天然满足数据自治（宪章 §3.3）；
 * - 单独可用：宿主缺 tools 服务时模型工具静默跳过（./tools.ts），本服务独立可用。
 *
 * @module @dsh-extra/dsh-architect
 */
import { checkDesign, renderReviewSkeleton, sectionOf, countEmptyCells, countUnfilledPlaceholders, DIMENSIONS, type CoverageResult, type DimensionKey } from 'architect-core'
import { checkDigest, type DigestInput, type DigestResult } from 'architect-core'

export const name = 'dsh-architect'
export const provide = ['dsh-architect']

export interface ArchitectService {
  version: string
  checkDesign(md: string): CoverageResult
  checkDigest(input: DigestInput): DigestResult
  renderReviewSkeleton(title: string, result: CoverageResult): string
  /** 底层解析器透出（高级用途：自定义 lint） */
  utils: { sectionOf: typeof sectionOf; countEmptyCells: typeof countEmptyCells; countUnfilledPlaceholders: typeof countUnfilledPlaceholders; dimensions: typeof DIMENSIONS }
}

export function createService(): ArchitectService {
  return {
    version: '0.1.0',
    checkDesign,
    checkDigest,
    renderReviewSkeleton,
    utils: { sectionOf, countEmptyCells, countUnfilledPlaceholders, dimensions: DIMENSIONS },
  }
}

export interface ArchitectContextLike {
  logger?: { info?: (...a: unknown[]) => void; warn?: (...a: unknown[]) => void }
  provide?: (name: string, value: unknown) => void
}

export function apply(ctx: ArchitectContextLike): void {
  const service = createService()
  if (typeof ctx.provide === 'function') {
    ctx.provide('dsh-architect', service)
  } else {
    ctx.logger?.warn?.('[dsh-architect] ctx.provide 不可用，服务未注册（本插件能力降级为不可见；不阻断宿主）')
  }
  ctx.logger?.info?.('[dsh-architect] 架构师检查器就绪：architect_digest / architect_design / architect_review（纯函数，无数据目录）')
}

export default Object.assign(apply, { inject: [] as string[], provide })

export type { CoverageResult, DimensionKey, DigestInput, DigestResult }
