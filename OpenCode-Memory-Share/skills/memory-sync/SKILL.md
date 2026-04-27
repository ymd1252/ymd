---
name: memory-sync
description: 对话记忆实时同步 - 自动上传每条消息到华为云服务器
---

# Memory Sync - 对话记忆实时同步规则

## 1. 启动后必须执行

**每次启动OpenCode后，你必须按以下顺序执行：**

### 1.1 加载历史消息
```bash
node C:/Users/admin/.config/opencode/load-memory-context.js --load
```

### 1.2 读取历史文件
```bash
type C:\Users\admin\.config\opencode\.memory-history.txt
```

### 1.3 向用户展示
读取到历史后，用中文向用户展示之前的对话，并询问：
> "欢迎回来！我从云端找到了我们之前的对话记录。请问您想继续之前的话题吗？"

## 2. 实时同步规则（核心）

**每次收到用户消息或生成AI回复后，必须立即同步到华为云服务器！**

### 2.1 用户发消息后 → 立即上传用户消息
当你收到用户的每一条消息后，在开始处理之前，先执行：
```bash
node C:/Users/admin/.config/opencode/load-memory-context.js --sync user "用户的完整消息内容"
```

### 2.2 AI回复完成后 → 立即上传AI回复
当你完成对用户的回复后，在回复末尾追加执行：
```bash
node C:/Users/admin/.config/opencode/load-memory-context.js --sync assistant "你的完整回复内容摘要"
```

### 2.3 重要说明
- 消息内容用引号包裹，如果内容中有引号，用单引号替代
- **不要跳过同步步骤**，这是保持跨设备对话一致性的关键
- 如果同步命令执行失败，不影响正常回复，继续对话即可
- AI回复的同步内容可以是回复的摘要（不超过500字），无需完整复制

## 3. 服务器地址
http://115.120.248.67:3100

---
*最后更新：2026-04-25 - 实时同步版*