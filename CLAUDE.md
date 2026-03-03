# PushFile 协作与发布规范

## 1) 沟通偏好
- 你通常使用语音输入，文本可能有口语化、省略、错别字。
- 处理需求时应先提炼真实意图，再执行，不要机械按字面理解。
- 发现"能直接修"的问题要主动修复，不要等下一句催促。

## 2) 开发流程（Staging → Production）

### 架构说明
- **Production 环境**：`/root/code/photo`（production 分支）→ photo.xaihub.de
- **Staging 环境**：`/root/code/photo-staging`（staging 分支）→ phototest.xaihub.de
- 两个目录共享同一个 Git 仓库（使用 git worktree）

### 开发步骤
1. 在 staging 目录改代码：
   ```bash
   cd /root/code/photo-staging
   # 改代码...
   ```
2. 保存后刷新 phototest.xaihub.de 看效果（已开启 --reload 自动重载）
3. 测试满意后提交：
   ```bash
   git add .
   git commit -m "feat: 我的新功能"
   git push origin staging
   ```
4. 在 GitHub 创建 PR：staging → production
5. 合并后自动触发部署（或手动执行 `deploy-prod`）

### 部署命令
- `deploy-prod` — 拉取 production 分支并重启生产服务
- `deploy-staging` — 拉取 staging 分支（一般不需要，--reload 自动生效）
- `rollback-prod [commit]` — 回滚生产到指定版本（不传则回退上一个）

## 3) 紧急故障处理（P0）
- 第一优先：恢复可用。
- **回滚命令**：
  ```bash
  rollback-prod          # 回退到上一个版本
  rollback-prod abc1234  # 回退到指定 commit
  ```
- 恢复后必须补 PR，把"临时修复"变成"可追踪代码变更"。

## 4) 版本号与构建时间规范
- 使用语义化版本：`major.minor.patch`
  - patch：小修复
  - minor：向后兼容的新功能
  - major：不兼容变更
- 展示格式：
  - 版本：`vX.Y.Z`
  - 构建时间：`MM-DD HH:mm`
- 不显示时区后缀，不使用"local/dev"作为对外展示文案。

## 5) Git 存档 Tag
- 当前稳定版本：`v1.1.0-prod-stable`
- 恢复命令：
  ```bash
  cd /root/code/photo
  git reset --hard v1.1.0-prod-stable
  systemctl restart photo-prod
  ```
