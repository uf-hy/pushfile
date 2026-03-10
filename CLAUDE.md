# PushFile 协作与发布规范

## 1) 沟通偏好
- 主人通常使用语音输入，文本可能有口语化、省略、错别字
- 处理需求时应先提炼真实意图，再执行，不要机械按字面理解
- 发现"能直接修"的问题要主动修复，不要等下一句催促
- **所有 commit 信息、注释、文档均使用中文**

## 2) ⚠️ 备份与存档（最高优先级）

**核心原则：多存档、勤 commit，宁可多一个还原点也不要丢代码。**

### 什么时候必须 commit
- 每完成一个独立功能或修复 → 立即 commit
- 开始任何有风险的操作前（重构、合并、部署） → 先 commit 当前状态
- 一次工作 session 中，至少每 30 分钟 commit 一次
- 收到"可以了"/"没问题"确认后 → 立即 commit 打标记

### 什么时候必须打 tag
- 重大功能上线后：`git tag v版本号`
- 部署/回滚前：**脚本已自动打 tag**（格式：`备份/部署前-日期-commit` 或 `备份/回滚前-日期-commit`）
- 手动存档：`git tag 备份/描述-$(date +%Y%m%d-%H%M%S)`

### 已知教训
- 曾因回滚时没有备份，丢失了大量代码回到很早的版本
- `deploy-prod` 和 `rollback-prod` 现在会**自动打 tag 备份**，不再依赖手动存档

## 3) 开发流程（Staging → Main）

### 架构说明
- **生产环境**：`/root/code/photo`（main 分支）→ photo.xaihub.de
- **测试环境**：`/root/code/photo-staging`（staging 分支）→ phototest.xaihub.de
- 两个目录共享同一个 Git 仓库（使用 git worktree）
- **⚠️ 共享上传目录**：两环境都指向 `/var/www/photo.xaihub.de/downloads`，测试环境上传会影响生产数据

### 基础设施
| 组件 | 生产 | 测试 |
|------|------|------|
| systemd 服务 | `photo-prod` | `photo-staging` |
| 端口 | 127.0.0.1:34109 | 127.0.0.1:34110 |
| 域名 | photo.xaihub.de | phototest.xaihub.de |
| 热重载 | 无（需重启） | `--reload` 自动重载 |
| 反向代理 | Caddy（`/etc/caddy/Caddyfile`） | 同左 |
| 运行时 | uv + uvicorn | 同左 |

### 开发步骤
1. 在 staging 目录改代码（`/root/code/photo-staging`）
2. 保存后刷新 phototest.xaihub.de 看效果（自动热重载，无需重启）
3. **每完成一步就 commit**：
   ```bash
   git add .
   git commit -m "功能: 我的新功能"
   ```
4. 测试满意后推送并创建 PR：
   ```bash
   git push origin staging
   # 然后在 GitHub 创建 PR：staging → main
   ```
5. PR 合并后执行 `deploy-prod` 部署到生产

### 部署命令
- **`deploy-prod`** — 自动备份（打 tag）→ 拉取 main → 重启 → 健康检查 → 失败自动回滚
- **`deploy-staging`** — 拉取 staging（一般不需要，热重载自动生效）
- **`rollback-prod [commit]`** — 自动备份（打 tag）→ 回滚到指定版本（默认上一个）→ 重启 → 健康检查 → 失败自动恢复

## 4) 紧急故障处理（P0）
- 第一优先：恢复服务可用
- 直接执行 `rollback-prod`（脚本会自动备份，不用手动存档）
- 恢复后必须补 PR，把"临时修复"变成"可追踪代码变更"

## 5) 版本号与构建时间
- 语义化版本：`major.minor.patch`（patch=小修复，minor=新功能，major=不兼容变更）
- 展示格式：版本 `vX.Y.Z`，构建时间 `MM-DD HH:mm`
- 不显示时区后缀

## 6) Git 存档 Tag
- 当前稳定版本：`v1.5.0`
- 恢复命令：
  ```bash
  cd /root/code/photo
  git reset --hard v1.1.0-prod-stable
  systemctl restart photo-prod
  ```
- 查看所有备份 tag：`git tag -l "备份/*"`
