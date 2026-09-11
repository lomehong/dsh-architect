/**
 * dsh-architect 插件入口（宿主端）。
 *
 * 提供 'dsh-architect' 服务：架构师职能的确定性检查器（需求准入六项覆盖 /
 * 方案六维度+五问覆盖检查与评分 / 评审骨架渲染 / 知识库结构校验）。模型工具
 * 入口见 ./tools.ts（preset 行 `@dsh-extra/dsh-architect/tools`）。
 *
 * 自带 agent preset「architect」（身份模型：主人 2026-09-11 裁决——dsh/omp 是
 * 宿主类型，architect 是独立 preset id 的 Agent 实例，御符按实例注入、与
 * digital-twin 分身不共享）：apply 时经 ./materialize.ts 版本化物化到
 * `$DSH_HOME/.agent-presets/architect/`。
 *
 * 纪律（套件宪章）：
 * - 零套件依赖（不 import 任何 @dsh-extra/*；对宿主服务的注入不受限）；
 * - 纯函数核心在 packages/architect-core（唯一事实源）；本外壳除 preset 物化
 *   （写自己名下的 .agent-presets/architect/）外不落盘、不联网；
 * - 单独可用：宿主缺 tools 服务时模型工具静默跳过（./tools.ts），本服务独立
 *   可用；物化失败仅告警不阻断宿主加载。
 *
 * @module @dsh-extra/dsh-architect
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { checkDesign, renderReviewSkeleton, sectionOf, countEmptyCells, countUnfilledPlaceholders, DIMENSIONS, type CoverageResult, type DimensionKey } from 'architect-core'
import { checkDigest, type DigestInput, type DigestResult } from 'architect-core'
import { materializeAt, packageDirHere } from './materialize.ts'

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
    version: '0.3.0',
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

function dshHome(): string {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh')
}

export function apply(ctx: ArchitectContextLike): void {
  const service = createService()
  if (typeof ctx.provide === 'function') {
    ctx.provide('dsh-architect', service)
  } else {
    ctx.logger?.warn?.('[dsh-architect] ctx.provide 不可用，服务未注册（本插件能力降级为不可见；不阻断宿主）')
  }
  // architect preset 版本化物化（fire-and-forget；失败仅告警，绝不阻断宿主加载）
  const ok = materializeAt(dshHome(), packageDirHere(), message => ctx.logger?.warn?.(message))
  ctx.logger?.info?.(ok
    ? '[dsh-architect] architect preset 物化就绪（.agent-presets/architect/）'
    : '[dsh-architect] architect preset 物化失败（跳过；宿主不受影响）')
}

export default Object.assign(apply, { inject: [] as string[], provide })

export type { CoverageResult, DimensionKey, DigestInput, DigestResult }
