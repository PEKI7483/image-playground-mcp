# GPT Image Playground MCP

让 Agent 通过浏览器使用 GPT Image Playground，完成图片生成、状态查询和原图保存。

你不需要修改 Playground 源码，也不需要把 Playground 的 API Key 交给 MCP。桥接服务只负责传递任务，浏览器扩展只操作页面中可见的控件。

> [!NOTE]
> 本项目适合已经可以正常打开 GPT Image Playground 的浏览器用户。图片页面仍由 Playground 负责登录、生成和管理自己的会话。

## 能做什么

- 根据提示词生成图片；
- 查询生成任务的状态；
- 将已完成任务的原图保存到指定位置；
- 让多个 Agent 共用同一个浏览器任务队列；
- 通过 MCP 参数传入参考图。

MCP 工具为 `generate_image`、`get_task_status` 和 `download_image`。

## 工作方式

```text
Agent
  -> MCP stdio
  -> 127.0.0.1 本机桥接服务
  -> Chromium 扩展
  -> GPT Image Playground 页面
  -> 返回任务结果
```

任务会按照提交顺序逐个处理。生成时间由 Playground 决定，没有固定的 20 秒完成期限；扩展领取任务后会持续等待页面完成，不会因为等待时间较长而重复提交。

## 开始之前

请准备：

- Node.js 18 或更高版本；
- Chrome、Chromium 或其他支持 Manifest V3 的 Chromium 浏览器；
- 一个可以正常打开 GPT Image Playground 的页面；
- 一个支持 MCP 的 Agent 客户端。

## 安装

### 1. 获取项目并构建

```bash
git clone https://github.com/PEKI7483/image-playground-mcp.git
cd image-playground-mcp
npm install
npm run build
```

### 2. 自动配置 Agent

先进行只读检查。它会识别常见 Agent 的配置位置，不会修改任何文件：

```bash
npx -y github:PEKI7483/image-playground-mcp setup --check
```

只配置一个 Agent：

```bash
npx -y github:PEKI7483/image-playground-mcp setup --agent codex
```

为已经检测到配置文件的 Agent 一次性写入：

```bash
npx -y github:PEKI7483/image-playground-mcp setup --all
```

安装器会在修改已有配置前自动创建备份，并保留其他 MCP 服务。它写入的是跨平台的 `npx` 启动方式，不会把连接 Token 写进 Agent 配置。

支持的目标包括：

`codex`、`claude-code`、`gemini`、`cursor`、`cline`、`roo`、`windsurf` 和 `claude-desktop`。

预览即将发生的修改：

```bash
npx -y github:PEKI7483/image-playground-mcp setup --agent codex --dry-run
```

如需使用其他端口，可以在配置时指定：

```bash
npx -y github:PEKI7483/image-playground-mcp setup --agent codex --port 8790
```

端口修改后，扩展设置中的图片工具地址也要使用同一个端口。

### 3. 安装浏览器扩展

1. 打开 Chrome 或 Chromium，访问 `chrome://extensions`。
2. 开启“开发者模式”。
3. 选择“加载已解压的扩展程序”。
4. 选择本项目中的 `extension` 目录。
5. 打开 GPT Image Playground 的普通画廊页面，并保持页面打开。
6. 启动或重启 Agent 客户端。
7. 点击浏览器工具栏中的扩展图标，查看运行概览。

通常不需要填写任何 Token。扩展会在启动后自动请求本机 Bridge 的 `/auth` 端点，并完成连接。只有在你主动修改过桥接端口时，才需要在“连接设置”中更新图片工具地址。

## 手动添加方式

自动配置适合大多数用户。若你希望由 Agent 的命令行工具直接添加 MCP，可以使用以下命令。

### Codex CLI 和 Codex 应用

```bash
codex mcp add gpt-image-playground -- \
  npx -y github:PEKI7483/image-playground-mcp
```

检查结果：

```bash
codex mcp list
```

更多信息请参阅 [Codex MCP 文档](https://developers.openai.com/codex/mcp/)。

### Claude Code

```bash
claude mcp add --transport stdio gpt-image-playground -- \
  npx -y github:PEKI7483/image-playground-mcp
```

### Gemini CLI、Cursor、Cline、Roo Code、Windsurf 和 Claude Desktop

在客户端的 MCP 设置中添加一个本地 STDIO 服务，或将以下对象合并到已有的 `mcpServers` 配置中：

```json
{
  "gpt-image-playground": {
    "command": "npx",
    "args": ["-y", "github:PEKI7483/image-playground-mcp"]
  }
}
```

请保留已有的其他 MCP 服务。Windows 用户通常由安装器自动使用 `npx.cmd`；手动编辑配置时，以客户端文档要求的命令格式为准。

保存后，请重启客户端或重新加载 MCP 配置。

## 确认连接

1. 打开 GPT Image Playground 的普通画廊模式页面。
2. 确认提示词输入框和生成按钮可见。
3. 确认 Agent 已加载 `gpt-image-playground` MCP。
4. 打开扩展小窗口，查看“运行概览”。

正常状态应包括：桥接服务可访问、扩展已连接、已找到图片页面。运行概览会显示当前队列和正在处理的任务。

桥接服务只监听本机回环地址。可以使用下面的命令确认本机端口已经启动；命令不会输出 Token：

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8787/auth
```

返回 `200` 表示 Bridge 已提供自动配对入口。

## 调用示例

### 生成图片

调用 `generate_image` 时至少传入一个提示词：

```json
{
  "prompt": "一座临海的现代图书馆，清晨柔和的自然光，建筑摄影风格"
}
```

工具会等待页面完成，不会把 20 秒当作任务期限。多个 Agent 同时提交时，请等待队列处理，不要重复提交同一请求。

### 使用参考图

参考图可以通过 MCP 参数传入：

```json
{
  "prompt": "保留参考图的构图，改成水彩插画",
  "reference_image_paths": [
    "<absolute-path-to-reference-image>"
  ]
}
```

支持 PNG、JPEG/JPG、WebP、GIF 和 AVIF；最多 16 张，单张不超过 8 MiB，总大小不超过 24 MiB。MCP 服务会读取文件并交给页面原有的多文件上传控件，图片处理仍由 Playground 完成。

### 下载原图

`generate_image` 返回 `task_id` 后，可以调用 `download_image`：

```json
{
  "task_id": "上一步返回的 task_id",
  "output_path": "<absolute-path-to-output-image>",
  "image_index": 0
}
```

下载读取的是任务详情中的原图，而不是任务卡片缩略图。详情原图可能晚于任务状态加载；扩展会兼容普通 `img` 元素，最多等待 60 秒，并在完成或失败后关闭详情弹窗。

已有输出文件只有在内容完全相同时才会幂等成功；内容不同则会提示冲突，不会覆盖原文件。

## 自动认证说明

扩展和 MCP 进程之间仍然有一层本机连接保护，但普通用户不需要手动处理它：

1. Bridge 启动时生成本机 Token；
2. 扩展请求 `http://127.0.0.1:<端口>/auth`；
3. 扩展将 Token 保存在扩展的会话存储中，并用于后续请求；
4. MCP 进程也会自动发现同一个 Bridge 的 Token。

`/auth` 是唯一免认证的本机配对入口，其他 `/v1/*` 接口仍然需要连接保护。Token 不写入 Cookie、网页 `localStorage` 或 Agent 配置，也不是 Playground API Key。

由于 `/auth` 面向本机自动配对，本机上拥有运行权限的其他进程理论上也可以请求它。这是降低配置成本与加强本机进程隔离之间的明确取舍。Bridge 默认只监听 `127.0.0.1`，不会对局域网开放。

## 安全与隐私

> [!IMPORTANT]
> Playground 的登录状态和 API Key 由 Playground 自己管理。本项目不读取或保存 Cookie、网页 `localStorage`、IndexedDB、页面 JavaScript 变量，也不直接调用图片 API。

- 扩展只操作 Playground 页面中可见的 DOM 控件；
- Bridge 只监听本机回环地址；
- 多个 Agent 可以共用同一个 Bridge 和队列；
- 任务始终由 Bridge 串行分配给浏览器扩展；
- 如果你需要进程级别的更强身份隔离，可以改用固定 Token 或 Native Messaging 部署方式。

## 常见问题

### 扩展显示“图片工具没有回应”

请依次确认：

1. Agent 客户端已经启动并加载 MCP；
2. 扩展中的地址是 `http://127.0.0.1:8787`，或与你配置的端口一致；
3. `chrome://extensions` 中的扩展已经重新加载；
4. GPT Image Playground 的普通画廊页面仍处于打开状态。

修改端口后，请同时更新安装器配置和扩展中的图片工具地址。通常不需要清理或复制任何 Token。

### 图片页面数量为 0

请打开普通画廊模式，并确认提示词输入框可见。扩展不会通过直接调用图片 API 工作，也不会处理没有对应页面控件的页面。

### 图片生成时间较长

不同提示词、参考图和页面状态所需时间可能不同。请查看 Playground 任务卡片和扩展运行概览，不要重复点击生成。已领取的任务会持续等待页面完成。

### 参考图没有出现

请确认文件路径是绝对路径、格式受支持、文件大小符合限制，并且 Playground 页面存在多文件上传控件。

### 下载原图失败

请确认任务已经完成、任务卡片仍然可见，并使用新的输出路径。下载流程不会读取浏览器存储作为备用来源。

## 配置项

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `MCP_BRIDGE_PORT` | `8787` | 本机 Bridge 端口；扩展地址需要与它一致 |
| `MCP_BRIDGE_TOKEN` | 自动生成 | 高级部署可指定固定本机连接值；普通安装无需设置 |
| `MCP_ACTIVE_STALE_MS` | `0` | 可选的任务心跳失联处理；不会自动重复生成 |

通常不需要手动启动 Bridge。MCP 客户端启动服务时，会自动发现或启动本机 Bridge。直接运行 `npm run bridge` 主要用于诊断。

## 设计边界

- 本项目不修改 GPT Image Playground 源码；
- API Key 留在 Playground 自己的浏览器会话中；
- 图片生成只通过页面可见操作完成；
- 浏览器关闭后，页面任务无法继续执行；
- 多个 Agent 共享同一个串行任务队列。

## 反馈与帮助

欢迎提交 [Issue](https://github.com/PEKI7483/image-playground-mcp/issues)。为了帮助我们更快定位问题，请提供 Agent 客户端及版本、浏览器及版本、扩展运行概览状态和任务错误信息。分享日志前，请移除 Token、个人路径和其他敏感信息。

感谢你花时间尝试这个工具。希望它能让图片生成工作更顺手，也让 Agent 与 Playground 之间的协作更自然。
