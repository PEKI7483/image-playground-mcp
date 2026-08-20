# GPT Image Playground MCP

让你的 Agent 通过浏览器使用 GPT Image Playground。

无需修改 Playground 源码。安装浏览器扩展并完成一次连接设置后，Agent 就可以提交图片生成任务、查看任务进度，并将生成的原图保存到本机。

本项目由 [CookSleep/gpt_image_playground](https://github.com/CookSleep/gpt_image_playground) 提供 Playground 页面基础能力。本项目围绕页面上可见的操作提供 MCP 桥接，不包含也不修改 Playground 源码。

> [!NOTE]
> Playground 仍然负责调用图像 API 并管理自己的登录状态。这个工具只负责传递任务和操作页面。

## 你可以这样使用

- 让 Agent 根据一句描述生成图片；
- 查询任务是否已经完成；
- 下载指定任务的原图；
- 让多个 Agent 共享同一个浏览器任务队列；
- 使用本地参考图参与生成。

对应的 MCP 工具为：`generate_image`、`get_task_status` 和 `download_image`。

## 工作方式

```text
Agent
  -> MCP stdio
  -> 本机桥接服务
  -> Chromium 扩展
  -> Playground 页面
  -> 生成并返回图片
```

任务会由本机桥接服务按提交顺序逐个处理。图片生成没有固定的 20 秒完成期限；扩展领取任务后会持续等待页面完成，并保持连接状态。不同图片的生成时间可能不同，这不会导致任务重复提交或自动重排。

浏览器关闭后，页面任务无法继续执行。重新打开浏览器后，请先查看原任务状态，再决定是否提交新的任务。

## 开始之前

请准备好：

- Node.js 18 或更高版本；
- Chrome、Chromium 或其他支持 Manifest V3 的 Chromium 浏览器；
- 一个可以正常打开 GPT Image Playground 的浏览器页面；
- 一个支持 MCP 的 Agent 客户端。

## 快速开始

### 1. 获取并构建项目

从 GitHub 获取项目：

```bash
git clone https://github.com/PEKI7483/image-playground-mcp.git
cd image-playground-mcp
npm install
npm run build
```

如果你将项目放在其他目录，后文中的 `<项目根目录>` 就是克隆出的 `image-playground-mcp` 目录。

构建完成后，`dist/` 目录中应包含 `server.js`、`bridge.js` 和 `bridgeMain.js`。

### 2. 生成连接码

连接码用于保护本机桥接服务，不是 Playground API Key。请生成一个随机连接码，并妥善保管：

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

扩展和每个 Agent 客户端都要使用同一个连接码。请不要将连接码提交到代码仓库或公开日志中。

默认桥接地址为 `http://127.0.0.1:8787`。如果端口已被占用，可以改用其他端口，例如 `8790`，但扩展和所有 Agent 必须保持一致。

### 3. 安装浏览器扩展

1. 打开 Chrome 或 Chromium，访问 `chrome://extensions`。
2. 开启右上角的“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择：

   ```text
   <项目根目录>/extension
   ```

5. 点击浏览器工具栏中的扩展图标，打开扩展小窗口。
6. 点击顶部的“连接设置”。
7. 将“图片工具地址”设置为 `http://127.0.0.1:8787`，将“连接码”设置为刚才生成的连接码。
8. 点击“保存并检查”。连接成功后，窗口会回到“运行概览”。

设置过程只在扩展小窗口内完成，不会打开新的标签页。扩展保存的是桥接地址和连接码，不保存 Playground API Key。

### 4. 选择你的 Agent

先完成扩展设置，再选择下面与你使用的 Agent 对应的方式。所有 Agent 可以共享一个桥接服务，但必须使用相同的连接码和端口。

| Agent | 添加方式 | 适合的配置位置 |
| --- | --- | --- |
| Codex CLI / Codex 应用 | `codex mcp add` 命令 | 共享 MCP 配置 |
| Claude Code | `claude mcp add` 命令 | 用户或项目配置 |
| Gemini CLI | MCP 设置文件 | `settings.json` |
| Cursor | MCP 设置或 JSON | `.cursor/mcp.json` |
| Cline | MCP 设置 | MCP Servers 页面 |
| Roo Code | MCP 设置 | MCP Servers 页面 |
| Windsurf | MCP 设置或 JSON | MCP 配置文件 |
| Claude Desktop | JSON 配置 | `claude_desktop_config.json` |

### Codex CLI 和 Codex 应用

Codex CLI、Codex 应用和 IDE 扩展共享 MCP 配置。将 `<项目根目录>` 和连接码替换为实际值后执行：

```bash
codex mcp add gpt-image-playground \
  --env MCP_BRIDGE_TOKEN=替换为连接码 \
  --env MCP_BRIDGE_PORT=8787 \
  -- node "<项目根目录>/dist/server.js"
```

检查配置：

```bash
codex mcp list
```

更多选项请参阅 [Codex MCP 官方文档](https://developers.openai.com/codex/mcp/)。

### Claude Code

```bash
claude mcp add --transport stdio gpt-image-playground \
  --env MCP_BRIDGE_TOKEN=替换为连接码 \
  --env MCP_BRIDGE_PORT=8787 \
  -- node "<项目根目录>/dist/server.js"
```

### Gemini CLI

Gemini CLI 通常通过 MCP 设置文件配置本地服务。请在其 `settings.json` 的 `mcpServers` 中加入以下内容：

```json
{
  "gpt-image-playground": {
    "command": "node",
    "args": ["<项目根目录>/dist/server.js"],
    "env": {
      "MCP_BRIDGE_TOKEN": "替换为连接码",
      "MCP_BRIDGE_PORT": "8787"
    }
  }
}
```

### Cursor、Cline、Roo Code、Windsurf 和 Claude Desktop

这些客户端可以在 MCP 设置页面中添加本地 STDIO 服务，也可以编辑对应的 JSON 配置。将下面的 `gpt-image-playground` 对象合并到已有的 `mcpServers` 中，请保留其他服务器配置：

```json
{
  "gpt-image-playground": {
    "command": "node",
    "args": ["<项目根目录>/dist/server.js"],
    "env": {
      "MCP_BRIDGE_TOKEN": "替换为连接码",
      "MCP_BRIDGE_PORT": "8787"
    }
  }
}
```

常见位置如下：

- Cursor：项目目录中的 `.cursor/mcp.json`，或 `Cursor Settings > MCP`；
- Cline：扩展中的 `MCP Servers` 页面；
- Roo Code：扩展中的 `MCP Servers` 页面；
- Windsurf：MCP 设置页面或其 MCP 配置文件；
- Claude Desktop：`claude_desktop_config.json` 中的 `mcpServers`。

保存后，请重启客户端或重新加载 MCP 配置。

MCP 客户端启动 `dist/server.js` 时，会通过 stdio 提供 MCP 协议，同时启动本机桥接服务。通常不需要手工运行 `npm start`。

## 启动并确认连接

1. 打开 GPT Image Playground，并保持普通画廊模式页面处于打开状态。
2. 确认提示词输入框和图片上传控件在页面中可见。
3. 启动或重启 Agent 客户端，使它加载刚才的 MCP 配置。
4. 点击浏览器工具栏中的扩展图标。
5. 在“运行概览”中确认桥接服务、扩展连接和 Playground 页面均处于正常状态。

也可以使用健康检查接口确认连接：

```bash
curl -H 'X-MCP-Bridge-Token: 替换为连接码' \
  http://127.0.0.1:8787/v1/health
```

健康状态示例：

```json
{
  "bridge": "running",
  "extensionConnected": true,
  "playgroundTabCount": 1,
  "queueLength": 0
}
```

## 调用示例

### 生成图片

调用 `generate_image`，至少传入一个提示词：

```json
{
  "prompt": "一只戴红色围巾的橘猫，工作室摄影风格"
}
```

工具会等待页面完成，不以 20 秒作为完成期限。多个 Agent 可以同时连接同一个桥接地址，任务会进入同一个 FIFO 队列并逐个执行。

### 使用参考图

参考图可以直接通过 MCP 参数传入，不需要手工点击 Playground 的上传控件：

```json
{
  "prompt": "保留参考图的构图，改成水彩插画",
  "reference_image_paths": [
    "/absolute/path/reference.png",
    "/absolute/path/style.jpg"
  ]
}
```

支持 PNG、JPEG/JPG、WebP、GIF 和 AVIF；最多 16 张，单张不超过 8 MiB，总大小不超过 24 MiB。MCP 服务读取这些本地文件后，扩展会注入 Playground 已有的多文件上传控件，图片处理仍由 Playground 页面完成。

### 下载生成结果

`generate_image` 成功后，使用返回的 `task_id` 调用 `download_image`：

```json
{
  "task_id": "上一步返回的 task_id",
  "output_path": "/absolute/path/generated.png",
  "image_index": 0
}
```

`output_path` 必须是绝对路径。已有文件只有在内容完全相同时才会幂等成功；如果内容不同，工具会提示冲突，不会覆盖原文件。

详情弹窗中的原图可能比任务卡片缩略图更晚加载。扩展会兼容普通 `img` 图片，最多等待 60 秒，并在下载完成或失败后关闭详情弹窗。

## 安全与隐私

> [!IMPORTANT]
> 你的 Playground 登录状态和 API Key 仍由 Playground 自己管理。这个工具只操作页面，不会读取或保存 Cookie、`localStorage`、IndexedDB、页面 JavaScript 变量或 API 响应中的密钥。

- 连接码只用于保护本机桥接接口，不是 Playground API Key；
- 桥接服务默认只监听本机回环地址；
- 图片生成通过 Playground 的可见页面完成，不直接调用图片 API；
- 参考图由 MCP 服务读取后交给 Playground 页面处理；
- 多个 Agent 可以共用服务，但应使用同一个连接码和端口。

## 常见问题

### 扩展显示“服务不可达”

请按下面的顺序检查：

1. Agent 客户端是否已经启动并加载了 `dist/server.js`？
2. 扩展中的桥接地址是否为 `http://127.0.0.1:8787`？
3. 扩展中的连接码是否与 Agent 配置完全一致？
4. 修改扩展代码后，是否在 `chrome://extensions` 点击了“重新加载”？
5. 是否已经打开 GPT Image Playground 的普通画廊页面？

如果仍然没有连接，请使用上面的健康检查命令，并保留返回结果，便于进一步定位。

### Playground 页面数量为 0

请打开 GPT Image Playground 的普通画廊模式页面，并确认提示词输入框可见。扩展不会通过直接调用图像 API 工作，也不会处理没有对应页面控件的页面。

### 生成时间较长，Agent 似乎没有响应

图片生成时间会因提示词、参考图和页面状态而不同。请先查看 Playground 任务卡片和扩展运行概览，不要重复点击生成。已领取的任务会继续等待页面完成，必要时可以使用 `get_task_status` 查询。

### 参考图没有出现

请确认：

- 文件路径是绝对路径；
- 文件格式受支持；
- 单张图片不超过 8 MiB，总大小不超过 24 MiB；
- 图片数量不超过 16 张；
- Playground 页面中存在多文件上传控件。

### 下载原图失败

请先确认任务已经完成、任务卡片仍然可见，并使用新的绝对输出路径。下载读取的是详情弹窗中的原图，不会通过浏览器存储读取图片。

## 配置项

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `MCP_BRIDGE_TOKEN` | 启动时随机生成 | MCP 与扩展之间的本机连接码；多个 Agent 需要固定为同一个值 |
| `MCP_BRIDGE_PORT` | `8787` | 本机桥接端口 |
| `MCP_ACTIVE_STALE_MS` | `0` | 默认关闭；开启后只会释放心跳失联任务，不会自动重试生成 |

如需单独启动桥接服务进行调试，可以使用：

```bash
MCP_BRIDGE_TOKEN='替换为连接码' MCP_BRIDGE_PORT=8787 npm run bridge
```

通常不需要手工运行这条命令。MCP 客户端启动 `dist/server.js` 时，会同时启动本机桥接服务。

## 反馈与帮助

如果你遇到问题，欢迎提交 [Issue](https://github.com/PEKI7483/image-playground-mcp/issues)。为了帮助我们更快了解情况，请一并提供：

- 使用的 Agent 客户端及版本；
- 浏览器及版本；
- 扩展运行概览中的状态；
- 健康检查接口返回结果；
- 相关任务的错误信息。

请在分享日志前移除连接码、个人路径和其他敏感信息。

## 设计边界

- 本项目不修改 GPT Image Playground 源码；
- API Key 留在 Playground 自己的浏览器会话中，MCP 和扩展不读取它；
- 任务只通过本机回环地址提供服务，并要求连接码；
- 浏览器关闭后，页面任务无法继续执行；
- 任务会保持串行处理，避免多个 Agent 同时操作同一个 Playground 页面。

感谢你花时间尝试这个工具。希望它能让图片生成工作更顺手，也让 Agent 与 Playground 之间的协作更自然。
