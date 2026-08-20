# GPT Image Playground MCP

这是一个不修改 GPT Image Playground 源码的浏览器扩展型 MCP 桥接工具：

本项目特别感谢 [CookSleep/gpt_image_playground](https://github.com/CookSleep/gpt_image_playground) 提供的 GPT Image Playground。请访问原项目了解 Playground 的源码、功能和最新进展；本项目只是围绕其可见页面提供本机 MCP 桥接能力，不包含或修改原项目源码。

```text
Agent -> MCP stdio -> 本机 HTTP 桥接 -> Chromium 扩展 -> Playground 页面 DOM
```

Playground 页面仍然负责调用图像 API 和保存自己的登录状态。MCP 服务和扩展只传递任务、操作页面并读取页面上已经生成的图片；扩展不会读取 Cookie、`localStorage`、IndexedDB、页面 JavaScript 变量或 API 响应中的密钥。

## 已提供的工具

- `generate_image`：提交提示词并等待页面报告生成完成或失败。
- `get_task_status`：查询页面中的任务状态和输出图片 ID。
- `download_image`：从完成任务的详情弹窗读取原图，并保存到本机绝对路径。

任务由本机桥接服务严格 FIFO 串行处理。图片生成没有固定 20 秒上限，扩展领取任务后会持续发送心跳并等待页面结束，因此不同生成时长不会导致任务自动重排或重复点击。浏览器关闭后，当前任务无法继续执行；重新打开页面后不要直接重复提交，应先检查原任务状态。

## 安装前准备

需要：

- Node.js 18 或更高版本；
- Chrome、Chromium 或其他支持 Manifest V3 的 Chromium 浏览器；
- 已能在浏览器中正常打开并使用 GPT Image Playground 的页面；
- 一个 MCP 客户端，例如支持 `mcpServers` 配置的 Agent 客户端。

以下命令以当前项目目录为例：

```bash
cd /run/media/peki/Xstar/Project/imageplayground/image-playground-mcp
npm install --no-bin-links
npm run build
```

外置磁盘上的部分环境无法创建 npm 的 `.bin` 符号链接，所以安装命令保留了 `--no-bin-links`。构建成功后，`dist/` 目录应包含 `server.js`、`bridge.js` 和 `bridgeMain.js`。

## 配置桥接令牌

桥接令牌只用于保护本机 MCP HTTP 接口，不是 Playground API Key。先生成一个随机令牌：

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

记下输出结果，下面三个位置必须使用同一个令牌：

1. MCP 客户端配置中的 `MCP_BRIDGE_TOKEN`；
2. 浏览器扩展选项页中的 `MCP_BRIDGE_TOKEN`；
3. 如果单独启动桥接服务，启动命令中的 `MCP_BRIDGE_TOKEN`。

不要把令牌提交到代码仓库或公开日志中。

默认桥接地址是 `http://127.0.0.1:8787`。如果端口被占用，可在 MCP 配置中同时设置 `MCP_BRIDGE_PORT`，并在扩展弹窗的“连接设置”中填写对应端口，例如 `http://127.0.0.1:8790`。

## 安装浏览器扩展

1. 打开 Chrome/Chromium，访问 `chrome://extensions`。
2. 开启右上角的“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择本项目的 `extension` 目录：

   ```text
   /run/media/peki/Xstar/Project/imageplayground/image-playground-mcp/extension
   ```

5. 点击浏览器工具栏中的扩展图标，打开扩展小窗口。
6. 点击顶部的“连接设置”。
7. 将“图片工具地址”填为 `http://127.0.0.1:8787`，将“连接码”填为上一步生成的同一个令牌。
8. 点击“保存并检查”。连接成功后会自动回到“运行概览”。

设置过程只在扩展小窗口内完成，不会打开新的标签页。扩展保存的只是桥接地址和连接码，不保存 Playground API Key。

## 配置 MCP 客户端

将下面的配置加入 MCP 客户端。把 `args` 中的路径改成项目的实际绝对路径，把 token 替换为刚才生成的令牌：

```json
{
  "mcpServers": {
    "gpt-image-playground": {
      "command": "node",
      "args": [
        "/run/media/peki/Xstar/Project/imageplayground/image-playground-mcp/dist/server.js"
      ],
      "env": {
        "MCP_BRIDGE_TOKEN": "替换为随机令牌",
        "MCP_BRIDGE_PORT": "8787"
      }
    }
  }
}
```

MCP 客户端启动 `dist/server.js` 时，它会通过 stdio 提供 MCP 协议，同时启动本机桥接服务。通常不需要在另一个终端手工运行 `npm start`。如需单独启动桥接服务进行调试，可以使用：

```bash
MCP_BRIDGE_TOKEN='替换为随机令牌' MCP_BRIDGE_PORT=8787 npm run bridge
```

使用单独桥接服务时，MCP 客户端配置也必须使用完全相同的 token 和端口。

## 启动和检查

1. 打开 GPT Image Playground，并保持普通画廊模式页面处于打开状态。
2. 确认提示词输入框和图片上传控件在页面中可见。
3. 启动或重启 MCP 客户端，使其加载上述配置。
4. 点击浏览器工具栏中的本扩展图标。
5. 在健康状态弹窗中确认：桥接服务正常、扩展心跳正常、Playground 页面数量至少为 1。

健康接口也可以用同一个 token 检查：

```bash
curl -H 'X-MCP-Bridge-Token: 替换为随机令牌' \
  http://127.0.0.1:8787/v1/health
```

## 调用示例

### 生成图片

调用 `generate_image`，至少传入：

```json
{
  "prompt": "一只戴红色围巾的橘猫，工作室摄影风格"
}
```

工具会等待页面完成，不以 20 秒作为完成期限。多个 Agent 可以同时连接同一个 MCP 桥接地址；任务会自动进入同一个 FIFO 队列并逐个执行。所有 Agent 必须使用相同的 `MCP_BRIDGE_TOKEN` 和 `MCP_BRIDGE_PORT`。

### 使用参考图

参考图不需要手工点击上传控件，直接传入本机绝对路径：

```json
{
  "prompt": "保留参考图的构图，改成水彩插画",
  "reference_image_paths": [
    "/absolute/path/reference.png",
    "/absolute/path/style.jpg"
  ]
}
```

支持 PNG、JPEG/JPG、WebP、GIF 和 AVIF；最多 16 张，单张不超过 8 MiB，总大小不超过 24 MiB。MCP 服务读取文件后，扩展会注入 Playground 已有的多文件上传控件，图片处理仍由 Playground 页面完成。

### 下载生成结果

`generate_image` 成功后，使用返回的 `task_id` 调用 `download_image`：

```json
{
  "task_id": "上一步返回的 task_id",
  "output_path": "/absolute/path/generated.png",
  "image_index": 0
}
```

`output_path` 必须是绝对路径。已有文件只有在内容完全相同时才会幂等成功；如果内容不同，工具会报错而不会覆盖原文件。

## 配置项

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `MCP_BRIDGE_TOKEN` | 启动时随机生成 | MCP 与扩展之间的本机认证令牌；多 Agent 必须固定为同一个值 |
| `MCP_BRIDGE_PORT` | `8787` | 本机桥接端口 |
| `MCP_ACTIVE_STALE_MS` | `0` | 默认关闭。开启后只会放弃心跳失联任务并释放队列，不会自动重试生成 |

## 常见问题

### 扩展显示桥接服务不可达

确认 MCP 客户端已经启动 `dist/server.js`，并检查扩展选项页中的 URL、端口和 token。也可以运行上面的 `curl` 健康检查。

### 桥接服务正常，但扩展心跳异常

确认扩展已经加载、选项页保存成功，并重新加载扩展。扩展选项页的 token 必须与 MCP 客户端完全一致。

### Playground 页面数量为 0

打开 GPT Image Playground 的普通画廊模式页面。扩展不会通过直接调用图像 API 工作，也不会处理没有对应页面控件的页面。

### 生成时间很长或调用方先超时

不要再次点击生成。先查看 Playground 任务卡片和扩展健康弹窗；已领取的任务不会因短租约或 20 秒限制而自动重排。必要时用 `get_task_status` 查询任务。

### 参考图没有出现

检查每个路径是否为绝对路径、文件格式是否支持、文件大小是否在限制内，并确认 Playground 当前页面存在多文件上传控件。

### 下载失败

确认任务已经完成、任务卡片仍在页面中，并使用新的绝对输出路径。下载从详情弹窗读取原图，不会通过浏览器存储读取图片。

## 设计边界

- 本项目不修改 GPT Image Playground 源码。
- API Key 留在 Playground 自己的浏览器会话中，MCP 和扩展不读取它。
- 任务只在本机回环地址提供服务，并要求 `X-MCP-Bridge-Token`。
- 浏览器关闭后无法继续执行页面任务；重新打开浏览器后应先检查原任务，而不是盲目重复提交。
