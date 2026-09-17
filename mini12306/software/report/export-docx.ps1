# 一键把 docs/ 下的 Markdown 文档导出为 Word（.docx），供实验报告引用或直接提交
#
# 用法：
#   pwsh -File report\export-docx.ps1                     # 导出 docs\*.md
#   pwsh -File report\export-docx.ps1 -Name "04"           # 只导出文件名含 04 的文档
#   pwsh -File report\export-docx.ps1 -Pdf                 # 额外导出 PDF（需本机有 xelatex）
#
# 依赖：pandoc（已验证 3.9）

param(
  [string]$Name = "",
  [switch]$Pdf
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot          # 项目根目录
$docsDir = Join-Path $root 'docs'
$outDir = Join-Path $PSScriptRoot 'out'

if (-not (Get-Command pandoc -ErrorAction SilentlyContinue)) {
  Write-Error "未找到 pandoc，请先安装：winget install --id JohnMacFarlane.Pandoc"
}

if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }

$files = Get-ChildItem -Path $docsDir -Filter '*.md' -File |
  Where-Object { $Name -eq '' -or $_.Name -like "*$Name*" } |
  Sort-Object Name

if ($files.Count -eq 0) {
  Write-Host "没有匹配的 Markdown 文档（-Name '$Name'）" -ForegroundColor Yellow
  exit 0
}

$ok = 0
$failed = @()

foreach ($f in $files) {
  $base = [System.IO.Path]::GetFileNameWithoutExtension($f.Name)
  $docx = Join-Path $outDir "$base.docx"
  Write-Host "→ 导出 $($f.Name)" -NoNewline

  # --toc 生成目录；--number-sections 不开启（文档内已有手工编号，避免重复）
  & pandoc $f.FullName `
    -o $docx `
    --from=gfm `
    --toc --toc-depth=3 `
    --standalone `
    -V lang=zh-CN `
    2>&1 | Out-Null

  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $docx)) {
    Write-Host "  [失败]" -ForegroundColor Red
    $failed += $f.Name
    continue
  }

  $size = [math]::Round((Get-Item $docx).Length / 1KB, 1)
  Write-Host "  [OK] ${size} KB"

  if ($Pdf) {
    $pdf = Join-Path $outDir "$base.pdf"
    & pandoc $f.FullName -o $pdf --from=gfm --toc --toc-depth=3 -V lang=zh-CN -V CJKmainfont="Microsoft YaHei" --pdf-engine=xelatex 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { Write-Host "    PDF 已生成" } else { Write-Host "    PDF 生成失败（可能缺少 xelatex）" -ForegroundColor Yellow }
  }

  $ok += 1
}

Write-Host ""
Write-Host "导出完成：成功 $ok / 共 $($files.Count)，输出目录：$outDir" -ForegroundColor Green
if ($failed.Count -gt 0) {
  Write-Host "失败文档：$($failed -join '、')" -ForegroundColor Red
}

Write-Host ""
Write-Host "提示：文档中的 Mermaid 图会以代码块形式保留。"
Write-Host "     如需图形，可用 VS Code 的 Markdown Preview Mermaid Support 插件查看，"
Write-Host "     或在支持 Mermaid 的 Markdown 编辑器（如 Typora / Obsidian）中渲染后再截图。"
