#requires -Version 5.1
<#
    NeuroTide 本地静态服务器（零 Node 依赖）

    为什么需要它：截图 OCR 依赖 worker / wasm / traineddata 的独立请求，
    浏览器在 file:// 下不会发这些请求，所以 OCR 模式必须走 http://。
    这个脚本替代 `npm run preview`，让分发包解压即用，不要求对方装 Node。

    特性：
    - 只绑定 127.0.0.1，不对外暴露，也不需要 URL ACL 管理员权限；
    - MIME 映射覆盖 wasm / traineddata，缺了会让 tesseract.js 加载失败；
    - 防路径穿越（../），并拒绝 dotfile；
    - 端口被占用时自动向后试探；
    - 响应带 no-store，避免改了产物后浏览器仍吃旧缓存。
#>

[CmdletBinding()]
param(
    # 起始端口，被占用时自动 +1 试探，最多试 20 个
    [int]$Port = 4173,
    # 服务根目录，默认取脚本同级目录（分发包里就是 index.html 所在处）。
    # 留空：param 默认值求值时 $PSScriptRoot 在部分宿主下仍不可用，
    # 实际取值放在下面的正文里做兜底。
    [string]$Root = '',
    # 静默模式：不自动打开浏览器（供其它脚本调用）
    [switch]$NoOpen
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# 根目录兜底：显式 -Root > $PSScriptRoot（脚本所在目录）
if ([string]::IsNullOrWhiteSpace($Root)) {
    $Root = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Definition }
}
$Root = [System.IO.Path]::GetFullPath($Root)
if (-not (Test-Path -LiteralPath $Root -PathType Container)) {
    Write-Error "服务根目录不存在：$Root"
    exit 2
}

# ── 端口探测 ────────────────────────────────────────────────────────────────
# 只试 127.0.0.1：绑定 '+' 或非 loopback 会触发 Windows URL ACL 检查，
# 那需要管理员权限，会让「解压即用」在普通用户机器上直接失败。
function Test-PortFree {
    param([int]$Candidate)
    $listener = $null
    try {
        $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Candidate)
        $listener.Start()
        return $true
    } catch {
        return $false
    } finally {
        if ($listener) { try { $listener.Stop() } catch { } }
    }
}

$port = $Port
for ($i = 0; $i -lt 20; $i++) {
    if (Test-PortFree -Candidate $port) { break }
    $port++
}
if (-not (Test-PortFree -Candidate $port)) {
    Write-Error "端口 $Port 起 20 个都不可用（$Port..$($Port + 19)），请关闭占用程序后重试。"
    exit 2
}

# ── 静态服务器 ──────────────────────────────────────────────────────────────
# 用 Sockets + 手写最小 HTTP/1.1 而非 System.Net.HttpListener：
# HttpListener 即使绑 127.0.0.1 也可能要求 URL ACL（管理员），
# 而 TcpListener 只 bind 不注册命名空间，普通用户必然可用。
$mime = @{
    '.html' = 'text/html; charset=utf-8'
    '.js'   = 'application/javascript; charset=utf-8'
    '.mjs'  = 'application/javascript; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'
    '.txt'  = 'text/plain; charset=utf-8'
    '.svg'  = 'image/svg+xml'
    '.png'  = 'image/png'
    '.jpg'  = 'image/jpeg'
    '.jpeg' = 'image/jpeg'
    '.gif'  = 'image/gif'
    '.ico'  = 'image/x-icon'
    '.wasm' = 'application/wasm'
    # tesseract.js 用这两个扩展名加载语言模型，缺 MIME 会解析失败
    '.traineddata' = 'application/octet-stream'
    '.gz'   = 'application/gzip'
}

# 解析并夹取到根目录内，任何 ../ 或绝对路径都拿不到根目录之外的文件
function Resolve-TargetPath {
    param([string]$UrlPath, [string]$BaseDir)

    $pathPart = ($UrlPath -split '\?')[0]
    $pathPart = ($pathPart -split '#')[0]
    try { $pathPart = [System.Uri]::UnescapeDataString($pathPart) } catch { return $null }

    if ($pathPart -eq '/' -or $pathPart -eq '') { $pathPart = '/index.html' }

    # 反斜杠一并规整，避免 '..\\' 绕过
    $pathPart = $pathPart -replace '\\', '/'

    $combined = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($BaseDir, $pathPart.TrimStart('/')))

    $baseFull = [System.IO.Path]::GetFullPath($BaseDir)
    if (-not $baseFull.EndsWith([System.IO.Path]::DirectorySeparatorChar)) {
        $baseFull += [System.IO.Path]::DirectorySeparatorChar
    }
    if (-not ($combined + [System.IO.Path]::DirectorySeparatorChar).StartsWith($baseFull)) {
        return $null
    }

    # 目录 -> index.html
    if (Test-Path -LiteralPath $combined -PathType Container) {
        $combined = [System.IO.Path]::Combine($combined, 'index.html')
    }
    return $combined
}

function Send-Response {
    param(
        [System.Net.Sockets.NetworkStream]$Stream,
        [int]$StatusCode,
        [string]$Reason,
        [byte[]]$Body,
        [string]$ContentType = 'text/plain; charset=utf-8'
    )
    $head = "HTTP/1.1 $StatusCode $Reason`r`n" +
    "Content-Type: $ContentType`r`n" +
    "Content-Length: $($Body.Length)`r`n" +
    "Cache-Control: no-store`r`n" +
    "Connection: close`r`n`r`n"

    $headBytes = [System.Text.Encoding]::ASCII.GetBytes($head)
    $Stream.Write($headBytes, 0, $headBytes.Length)
    if ($Body.Length -gt 0) { $Stream.Write($Body, 0, $Body.Length) }
    $Stream.Flush()
}

$server = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $port)
$server.Start()

$url = "http://127.0.0.1:$port/"
Write-Host ''
Write-Host '  NeuroTide 本地服务已启动'
Write-Host '  ----------------------------------------'
Write-Host "  地址：  $url"
Write-Host "  目录：  $Root"
Write-Host '  仅监听本机，不会上传任何数据。'
Write-Host '  关闭本窗口即停止服务。'
Write-Host ''

if (-not $NoOpen) {
    try { Start-Process $url } catch { Write-Host "  （未能自动打开浏览器，请手动访问上面的地址）" }
}

$running = $true
try {
    while ($running) {
        $client = $server.AcceptTcpClient()
        $stream = $client.GetStream()
        try {
            # 读请求行：METHOD SP TARGET SP VERSION CRLF
            $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::ASCII)
            $requestLine = $reader.ReadLine()
            if (-not $requestLine) { continue }

            # 丢弃请求头（逐行读到空行）
            while ($true) {
                $header = $reader.ReadLine()
                if ($null -eq $header -or $header -eq '') { break }
            }

            $parts = $requestLine -split '\s+'
            $target = if ($parts.Length -ge 2) { $parts[1] } else { '/' }

            # dotfile 一律不提供，避免把 .git / .env 之类的文件端出去
            $filePath = Resolve-TargetPath -UrlPath $target -BaseDir $Root
            if (-not $filePath -or -not (Test-Path -LiteralPath $filePath -PathType Leaf)) {
                $body = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found`n$target")
                Send-Response -Stream $stream -StatusCode 404 -Reason 'Not Found' -Body $body
                continue
            }

            $name = [System.IO.Path]::GetFileName($filePath).ToLowerInvariant()
            $ext = [System.IO.Path]::GetExtension($name)
            $contentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
            # dotfile 检查（路径已解析成绝对路径，此处按文件名末段判断更稳）
            if ($name.StartsWith('.')) {
                $body = [System.Text.Encoding]::UTF8.GetBytes("403 Forbidden`n")
                Send-Response -Stream $stream -StatusCode 403 -Reason 'Forbidden' -Body $body
                continue
            }

            $bytes = [System.IO.File]::ReadAllBytes($filePath)
            Send-Response -Stream $stream -StatusCode 200 -Reason 'OK' -Body $bytes -ContentType $contentType
        } catch {
            # 单个请求出错不能拖垮整个服务
            try {
                $body = [System.Text.Encoding]::UTF8.GetBytes("500 Internal Server Error`n")
                Send-Response -Stream $stream -StatusCode 500 -Reason 'Internal Server Error' -Body $body
            } catch { }
        } finally {
            try { $stream.Dispose() } catch { }
            try { $client.Close() } catch { }
        }
    }
} finally {
    try { $server.Stop() } catch { }
}
