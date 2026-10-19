# 不用安裝任何東西的小型網頁伺服器（Windows 內建 PowerShell）
# 用法：powershell -ExecutionPolicy Bypass -File tools\serve.ps1 -Port 3000
param([int]$Port = 3000)

$root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$mime = @{
  '.html' = 'text/html; charset=utf-8'
  '.js'   = 'text/javascript; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.json' = 'application/json'
  '.png'  = 'image/png'
  '.svg'  = 'image/svg+xml'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
try {
  $listener.Start()
} catch {
  Write-Host "無法啟動網頁伺服器：連接埠 $Port 可能已被使用（是不是已經開過一次了？）"
  exit 1
}
Write-Host "遊戲網址： http://localhost:$Port/"
Write-Host "模擬模式： http://localhost:$Port/?sim=1"

while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $res = $ctx.Response
  try {
    $path = [System.Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath)
    if ($path -eq '/') { $path = '/index.html' }
    $file = [System.IO.Path]::GetFullPath((Join-Path $root ($path.TrimStart('/'))))
    $rel = $file.Substring([Math]::Min($file.Length, $root.Length))
    $blocked = $rel -match '^[\\/](bridge|tools|node_modules)[\\/]'
    if ($blocked -or -not $file.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $file -PathType Leaf)) {
      $res.StatusCode = 404
    } else {
      $bytes = [System.IO.File]::ReadAllBytes($file)
      $ext = [System.IO.Path]::GetExtension($file).ToLower()
      if ($mime.ContainsKey($ext)) { $res.ContentType = $mime[$ext] } else { $res.ContentType = 'application/octet-stream' }
      $res.Headers.Add('Cache-Control', 'no-cache')
      $res.ContentLength64 = $bytes.Length
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
    }
  } catch {
    $res.StatusCode = 500
  } finally {
    $res.Close()
  }
}
