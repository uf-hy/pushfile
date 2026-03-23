# 工程记忆总览

## 目标

这里存放 **长期有效、需要被后续人类与 agent 反复检索的工程记忆**。

它和 `.sisyphus/` 的关系如下：

- `docs/engineering/`：长期真相（durable memory）
- `.sisyphus/notepads/`：任务期工作记忆（working memory）
- `.sisyphus/evidence/`：单次运行证据（evidence）
- `.sisyphus/plans/`：任务计划与拆解（plans）

## 读取顺序

当任务涉及以下任一内容时，必须优先读取本目录：

- 前端页面改动
- Playwright / 视觉验收 / 截图复核
- agent 工作流、审核回环、验证策略
- 决策复盘、已知坑位、可复用执行流程

推荐读取顺序：

1. 本文件：了解目录结构与规则
2. `adr/`：理解已生效的关键决策
3. `playbooks/`：照着执行具体流程
4. `evals/`：确认放行标准与状态矩阵
5. `pitfalls/`：避免重复踩坑
6. 如需任务上下文，再读相关 `.sisyphus/notepads/<initiative>/`

## 目录约定

### `adr/`

存放 Architectural / Workflow Decision Record。

适合记录：

- 为什么废弃旧方案
- 为什么采用新主链路
- 为什么某工具降级为辅助
- 哪些规则已经被视为默认工程决策

### `playbooks/`

存放可执行的操作手册。

适合记录：

- 改了哪些页面就怎么验
- 如何用 Playwright 走用户路径
- 如何截图、复核、补拍局部、继续修改

### `evals/`

存放放行标准、状态矩阵、验收边界。

适合记录：

- 某页面必须覆盖哪些状态
- desktop / mobile 最低覆盖要求
- 什么证据才算“已审”

### `pitfalls/`

存放失败模式、漏审模式、误判来源。

适合记录：

- 这次是怎么翻车的
- 哪些信号会制造“假通过”
- 哪些产物不能被误当作长期知识

## 提升规则（Promote Rule）

当 `.sisyphus/notepads/` 中的某条内容满足以下任一条件时，应提升到本目录：

- 后续任务很可能重复用到
- 是一次真实事故后的稳定结论
- 已经不再只是当前 session 的临时判断
- 需要被后续 agent 在新会话中直接检索到

## 反模式

以下内容 **不得** 充当长期工程记忆：

- 聊天记录本身
- 单张截图本身
- `report.json` 的单个 `pass`
- `visual-loop/` 或 `.sisyphus/evidence/` 中未经提炼的运行产物

一句话：

> **证据不是结论，结论要进入 `docs/engineering/`。**
