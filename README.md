# NeuroTide

NeuroTide 是一个纯前端的个人数据情绪地图：导入聊天记录 TXT 后，在浏览器本地解析文本、按天聚合情绪，并通过日历热力图和当日趋势图展示结果。

## 功能

- 支持拖拽或选择 TXT 聊天记录
- 支持载入内置合成示例数据
- 按天计算情绪值并显示日历热力图
- 支持近 3 个月、近半年和全部数据筛选
- 查看某一天的情绪趋势、主导情绪词和原始记录
- 导出当前热力图为 PNG
- 所有解析和计算均在浏览器中完成

## 数据格式

每条记录使用以下格式：

```text
[YYYY-MM-DD HH:mm:ss] 昵称: 内容
```

例如：

```text
[2026-09-26 08:12:00] 我: 今天的天气很好，心情很轻松。
```

也支持消息续行：不带时间戳的后续行会并入上一条记录。

## 本地运行

环境要求：Node.js 18 或更高版本。

安装依赖：

```bash
npm install
```

启动开发服务器：

```bash
npm run dev
```

构建生产文件：

```bash
npm run build
```

构建结果会输出到 `dist/index.html`。项目配置了单文件构建，生成的 HTML 可以通过浏览器打开，或使用项目根目录的 `open-neurotide.bat` 启动本地预览服务器。

预览生产构建：

```bash
npm run preview
```

## 隐私说明

NeuroTide 没有后端服务，也不会调用外部 API。用户选择的 TXT 文件只在当前浏览器页面中读取和处理，不会上传到服务器。

请不要把包含真实个人信息的聊天记录提交到公开代码仓库。仓库中的聊天样例文件默认被 Git 忽略，应用内置的示例数据为程序生成的合成数据。

## 技术栈

- Vite
- React
- TypeScript
- Tailwind CSS
- Framer Motion
- Canvas API

## 许可证

本项目采用 MIT License，详见 [LICENSE](./LICENSE)。
