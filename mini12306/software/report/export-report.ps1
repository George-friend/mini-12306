# 把实验报告 Markdown 导出为 Word（.docx），并自动嵌入截图
#
# 用法：
#   powershell -File report\export-report.ps1                    # 导出 report 下所有实验报告
#   powershell -File report\export-report.ps1 -Name "实验一"      # 只导出文件名含"实验一"的报告
#   powershell -File report\export-report.ps1 -NoToc              # 不生成目录
#
# 依赖：pandoc（已验证 3.9）
# 说明：使用 pandoc 的 markdown 方言而非 gfm，以支持图片尺寸语法 ![](x.png){width=15cm}

param(
  [string]$Name = "",
  [switch]$NoToc
)

$ErrorActionPreference = 'Stop'
$reportRoot = $PSScriptRoot

if (-not (Get-Command pandoc -ErrorAction SilentlyContinue)) {
  Write-Error "未找到 pandoc，请先安装：winget install --id JohnMacFarlane.Pandoc"
}

# 收集 report 目录下（含子目录）的报告 Markdown，跳过说明类文件
$files = Get-ChildItem -Path $reportRoot -Recurse -Filter '*.md' -File |
  Where-Object { $_.FullName -notmatch '\\out\\' -and $_.Name -match '实验.*报告|交互记录' } |
  Where-Object { $Name -eq '' -or $_.Name -like "*$Name*" } |
  Sort-Object FullName

if ($files.Count -eq 0) {
  Write-Host "没有找到匹配的实验报告 Markdown（-Name '$Name'）" -ForegroundColor Yellow
  exit 0
}

$ok = 0
$failed = @()

foreach ($f in $files) {
  $dir = Split-Path -Parent $f.FullName
  $base = [System.IO.Path]::GetFileNameWithoutExtension($f.Name)
  $docx = Join-Path $dir "$base.docx"
  Write-Host "→ 导出 $($f.Name)"

  $args = @(
    $f.FullName,
    '-o', $docx,
    '--from=markdown',
    "--resource-path=$dir",
    '-V', 'lang=zh-CN'
  )
  if (-not $NoToc) { $args += @('--toc', '--toc-depth=2') }

  & pandoc @args 2>&1 | Out-Null

  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $docx)) {
    Write-Host "  [失败]" -ForegroundColor Red
    $failed += $f.Name
    continue
  }

  # 统计 docx 内嵌图片数量（docx 本质是 zip，图片在 word/media/ 下）
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [System.IO.Compression.ZipFile]::OpenRead($docx)
  $imgCount = ($zip.Entries | Where-Object { $_.FullName -like 'word/media/*' }).Count
  $zip.Dispose()

  $size = [math]::Round((Get-Item $docx).Length / 1KB, 1)
  Write-Host ("  [OK] {0} KB，内嵌图片 {1} 张" -f $size, $imgCount)
  $ok += 1
}

Write-Host ""
Write-Host "导出完成：成功 $ok / 共 $($files.Count)" -ForegroundColor Green
if ($failed.Count -gt 0) { Write-Host "失败：$($failed -join '、')" -ForegroundColor Red }
Write-Host ""
Write-Host "提示：报告中的截图已随 docx 一起嵌入，可直接提交；"
Write-Host "     若需替换占位图，覆盖 '截图' 目录下的同名文件后重新运行本脚本即可。"
