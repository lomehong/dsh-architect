# @dsh-extra/dsh-architect · 架构师检查器

架构师 Agent 的**确定性检查器**（数字分身套件阶段 3 工具化，HANDOFF §6）：
把方法论中可机械判定的部分做成纯函数与模型工具——需求准入六项覆盖检查、
可执行技术方案六维度+五问覆盖检查与评分、评审骨架生成。

> 方法论与流程见 `digital-architect` 仓（知识库 + 三个 SKILL）；本插件只做**机械检查**，
> 不替代架构判断，更不替代主人确认（自报 ≠ 完成）。

## 提供的能力

| 面 | 内容 |
|---|---|
| 服务 `dsh-architect` | `checkDesign`（六维度+五问覆盖检查）/ `checkDigest`（需求准入六项覆盖）/ `renderReviewSkeleton`（评审骨架）/ 解析工具集 |
| 模型工具（`./tools`） | `architect_digest` 需求准入、`architect_design` 方案自检、`architect_review` 评审评分+骨架 |
| 数据目录 | **无**（纯函数、零持久化、零网络——天然满足宪章 §3.3 数据自治） |

## 单独安装

```bat
dsh plugin --profile <name> add
```

- 主插件行（cordis.patch.yml）：`@dsh-extra/dsh-architect`（provide 服务，无配置）。
- 模型工具行：在 agent 预设（dsh-twin 物化的预设）插件列表追加 `@dsh-extra/dsh-architect/tools`
  （对齐 dsh-task-board/tools 的挂载形态；条件装配——装了才有行，没装预设依然可用）。
- 降级行为：宿主 tools 服务缺席 → 工具静默跳过；兄弟插件全部缺席 → 本插件完整可用（无套件依赖）。

## 与看板/账本的关系（可选增强，缺席降级）

- 本插件**不直接调用**看板/账本服务——方案落定后的任务拆解由会话经既有
  `task_delegate` 工具完成（治理照常走账本 L0-L3）；本插件只产出检查结论与骨架。
- 因此不存在对兄弟插件的运行时耦合；依赖矩阵申报：提供 `dsh-architect` 服务与
  `tool-architect` 工具入口，套件增强消费方向为空。

## 测试

```sh
npm ci
npm run typecheck
npm test
npm run build
```

提交前纪律（宪章 §6）：改动仓测试全绿 + 工作区干净。

## 输出纪律

工具返回键 ⊆ output schema（`additionalProperties: false`）——宿主按 schema 校验，
多余键即拒（宪章整改⑬教训，测试固化）。
