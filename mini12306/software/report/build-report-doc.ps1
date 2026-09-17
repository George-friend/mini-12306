# 把「实验一-报告内容.md」填写进课程下发的实验报告书模板，生成可直接提交的 Word 文档。
#
# 设计原则：**只往模板里加内容，不改动模板的任何格式**
#   - 复制模板文件后再填写，原模板保持不动
#   - 正文沿用模板的字体（宋体 / Times New Roman）与字号（五号 10.5pt、小四 12pt）
#   - 三个部分的正文分别写入模板表格第 4/5/6 行的合并单元格内
#   - 成绩评定表（模板自带的嵌套表格）保持原样，由教师填写
#
# 用法：
#   powershell -File report\build-report-doc.ps1
#   powershell -File report\build-report-doc.ps1 -Experiment "实验一-项目选题与结对编程"
#
# 依赖：Word（本机已安装 Office）

param(
  [string]$Template = "实验1-4,6-7的实验报告书模板.doc",
  [string]$Experiment = "实验一-项目选题与结对编程",
  [string]$ContentFile = "实验一-报告内容.md",
  [string]$OutputName = "实验一-实验报告.doc"
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$tplPath = Join-Path $root $Template
$expDir = Join-Path (Join-Path $root 'report') $Experiment
$mdPath = Join-Path $expDir $ContentFile
$outPath = Join-Path $expDir $OutputName

foreach ($p in @($tplPath, $mdPath)) {
  if (-not (Test-Path -LiteralPath $p)) { Write-Error "找不到文件：$p" }
}

# 正文字号：模板正文为五号 10.5pt，一级小标题用 12pt 加粗
$SIZE_BODY = 10.5
$SIZE_H2 = 12
$SIZE_H3 = 10.5
$FONT_CN = '宋体'
$FONT_EN = 'Times New Roman'

# ── 解析 Markdown 内容 ────────────────────────────────────────
$lines = [System.IO.File]::ReadAllLines($mdPath, [System.Text.Encoding]::UTF8)

# 1) 元信息（--- 包裹的 YAML 片段，仅取 key: value）
$meta = @{}
$i = 0
if ($lines[0].Trim() -eq '---') {
  $i = 1
  while ($i -lt $lines.Count -and $lines[$i].Trim() -ne '---') {
    $line = $lines[$i]
    $idx = $line.IndexOf(':')
    if ($idx -gt 0) { $meta[$line.Substring(0, $idx).Trim()] = $line.Substring($idx + 1).Trim() }
    $i++
  }
  $i++
}

# 2) 按 "# 第X部分" 切分
$parts = @{}
$current = $null
$buffer = New-Object System.Collections.ArrayList
for (; $i -lt $lines.Count; $i++) {
  $line = $lines[$i]
  if ($line -match '^#\s*第(一|二|三)部分') {
    if ($current) { $parts[$current] = $buffer.ToArray() }
    $current = $Matches[1]
    $buffer = New-Object System.Collections.ArrayList
    continue
  }
  if ($current) { [void]$buffer.Add($line) }
}
if ($current) { $parts[$current] = $buffer.ToArray() }

"解析完成：元信息 $($meta.Count) 项，第一部分 $($parts['一'].Count) 行，第二部分 $($parts['二'].Count) 行，第三部分 $($parts['三'].Count) 行"

# ── 复制模板 ──────────────────────────────────────────────────
if (Test-Path -LiteralPath $outPath) { Remove-Item -LiteralPath $outPath -Force }
Copy-Item -LiteralPath $tplPath -Destination $outPath -Force
"已复制模板 → $OutputName"

$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0

try {
  $doc = $word.Documents.Open($outPath, $false, $false)
  $tbl = $doc.Tables.Item(1)

  # ── 1. 填写表头信息栏 ──────────────────────────────────────
  $headerMap = @(
    @{ row = 1; cell = 2; key = '实验项目名称' },
    @{ row = 2; cell = 2; key = '实验者' },
    @{ row = 2; cell = 4; key = '专业班级' },
    @{ row = 2; cell = 6; key = '组别' },
    @{ row = 3; cell = 2; key = '同组者' },
    @{ row = 3; cell = 4; key = '实验日期' }
  )
  foreach ($h in $headerMap) {
    if ($meta.ContainsKey($h.key)) {
      $cellRange = $tbl.Rows.Item($h.row).Cells.Item($h.cell).Range
      # 只替换文字内容，保留单元格原有字体与段落格式
      $cellRange.Text = $meta[$h.key]
    }
  }
  "表头信息已填写"

  # ── 2. 通用写入函数 ────────────────────────────────────────
  # 说明：用「文档位置整数」作为游标，每次都在游标处插入，插入后游标前移。
  #       这样不受 Word Range 对象因结构变化而失效的影响。

  function Set-ChunkFont($docObj, $from, $to, $size, $bold) {
    if ($to -le $from) { return }
    $r = $docObj.Range($from, $to)
    try { $r.Font.NameFarEast = $FONT_CN } catch { }
    try { $r.Font.NameAscii = $FONT_EN } catch { }
    try { $r.Font.NameOther = $FONT_EN } catch { }
    # 注意：Word 的 Font.Size 只接受 double，传 int（如 12、9）会抛「指定的转换无效」
    try { $r.Font.Size = [double]$size } catch { Write-Warning "设置字号失败($size)：$($_.Exception.Message)" }
    try { $r.Font.Bold = $(if ($bold) { 1 } else { 0 }) } catch { }
  }

  # 插入富文本（支持 **加粗**），返回新的游标
  function Add-RichParagraph($docObj, $cursor, $text, $size, $boldAll) {
    $start = $cursor
    $segments = [regex]::Split($text, '(\*\*[^*]+\*\*)')
    $r = $docObj.Range($cursor, $cursor)
    $r.InsertAfter('')   # 确保 range 有效
    foreach ($seg in $segments) {
      if ([string]::IsNullOrEmpty($seg)) { continue }
      $bold = $boldAll
      $t = $seg
      if ($seg.Length -gt 4 -and $seg.StartsWith('**') -and $seg.EndsWith('**')) {
        $t = $seg.Substring(2, $seg.Length - 4)
        $bold = $true
      }
      $before = $r.End
      $r.InsertAfter($t)
      Set-ChunkFont $docObj $before $r.End $size $bold
    }
    $r.InsertAfter("`r")
    $endp = $r.End
    Set-ChunkFont $docObj $start $endp $size $boldAll
    # 段落格式：与模板正文一致（单倍行距、段前段后 0、无首行缩进）
    try {
      $p = $docObj.Range($start, $endp).Paragraphs.Item(1)
      $p.LineSpacingRule = 0
      $p.SpaceAfter = [double]0
      $p.SpaceBefore = [double]0
      $p.FirstLineIndent = [double]0
    } catch { Write-Warning "设置段落格式失败：$($_.Exception.Message)" }
    return $endp
  }

  # 插入表格（嵌套在单元格内）
  function Add-Table($docObj, $cursor, $rows) {
    $nRows = $rows.Count
    $nCols = $rows[0].Count
    # 表格前需要一个空段落作为锚点
    $r = $docObj.Range($cursor, $cursor)
    $r.InsertAfter("`r")
    $anchor = $docObj.Range($r.Start, $r.End)
    $newTbl = $docObj.Tables.Add($anchor, $nRows, $nCols)
    $newTbl.Borders.InsideLineStyle = 1
    $newTbl.Borders.OutsideLineStyle = 1
    try { $newTbl.Range.Font.NameFarEast = $FONT_CN } catch { }
    try { $newTbl.Range.Font.NameAscii = $FONT_EN } catch { }
    try { $newTbl.Range.Font.Size = [double]9 } catch { Write-Warning "表格字号设置失败：$($_.Exception.Message)" }
    try {
      $newTbl.Range.ParagraphFormat.LineSpacingRule = 0
      $newTbl.Range.ParagraphFormat.SpaceAfter = [double]0
      $newTbl.Range.ParagraphFormat.SpaceBefore = [double]0
    } catch { }
    for ($rr = 0; $rr -lt $nRows; $rr++) {
      for ($cc = 0; $cc -lt $nCols; $cc++) {
        $txt = $rows[$rr][$cc]
        if ($null -eq $txt) { $txt = '' }
        $newTbl.Cell($rr + 1, $cc + 1).Range.Text = $txt
      }
    }
    # 表格后补一个空段落，便于后续插入
    $afterPos = $newTbl.Range.End
    $tail = $docObj.Range($afterPos, $afterPos)
    $tail.InsertAfter("`r")
    return $tail.End
  }

  # 插入图片（等比缩放到指定宽度；若高度超过页面可用高度则改按高度约束）
  function Add-Image($docObj, $cursor, $imgPath, $widthCm) {
    $full = Join-Path $expDir $imgPath
    if (-not (Test-Path -LiteralPath $full)) {
      Write-Warning "图片不存在，已跳过：$imgPath"
      return $cursor
    }
    $r = $docObj.Range($cursor, $cursor)
    $r.InsertAfter("`r")
    $anchor = $docObj.Range($r.Start, $r.End)
    $shape = $docObj.InlineShapes.AddPicture($full, $false, $true, $anchor)

    $ratio = [double]$shape.Height / [double]$shape.Width
    $maxH = 20.5 * 28.35                       # 页面可用高度约 21cm，留出余量
    $w = [double]$widthCm * 28.35
    $h = $w * $ratio
    if ($h -gt $maxH) { $h = $maxH; $w = $h / $ratio }   # 长图按高度约束

    try { $shape.LockAspectRatio = 0 } catch { }
    try { $shape.Width = [single]$w } catch { Write-Warning "设置图片宽度失败：$($_.Exception.Message)" }
    try { $shape.Height = [single]$h } catch { Write-Warning "设置图片高度失败：$($_.Exception.Message)" }
    try { $anchor.ParagraphFormat.Alignment = 1 } catch { }   # 居中
    try { $anchor.ParagraphFormat.LineSpacingRule = 0 } catch { }

    $tailPos = $shape.Range.End
    $tail = $docObj.Range($tailPos, $tailPos)
    $tail.InsertAfter("`r")
    return $tail.End
  }

  # ── 3. 把每个部分的 Markdown 写入对应单元格 ─────────────────
  function Fill-Part($docObj, $tblObj, $rowIndex, $mdLines) {
    $cell = $tblObj.Rows.Item($rowIndex).Cells.Item(1)
    $headingPara = $cell.Range.Paragraphs.Item(1)
    $cursor = $headingPara.Range.End

    $idx = 0
    while ($idx -lt $mdLines.Count) {
      $line = $mdLines[$idx]
      $trim = $line.Trim()

      if ($trim -eq '') { $idx++; continue }

      # 一级小标题
      if ($trim.StartsWith('## ')) {
        $cursor = Add-RichParagraph $docObj $cursor $trim.Substring(3) $SIZE_H2 $true
        $idx++; continue
      }
      # 二级小标题
      if ($trim.StartsWith('### ')) {
        $cursor = Add-RichParagraph $docObj $cursor $trim.Substring(4) $SIZE_H3 $true
        $idx++; continue
      }
      # 表格
      if ($trim.StartsWith('|')) {
        $rows = @()
        while ($idx -lt $mdLines.Count -and $mdLines[$idx].Trim().StartsWith('|')) {
          $cellsRaw = $mdLines[$idx].Trim().Trim('|') -split '\|'
          $cellsArr = @()
          foreach ($c in $cellsRaw) { $cellsArr += $c.Trim() }
          # 跳过分隔行（---）
          $isSep = $true
          foreach ($c in $cellsArr) { if ($c -notmatch '^:?-{2,}:?$') { $isSep = $false; break } }
          if (-not $isSep) { $rows += , $cellsArr }
          $idx++
        }
        if ($rows.Count -gt 0) { $cursor = Add-Table $docObj $cursor $rows }
        continue
      }
      # 图片
      if ($trim -match '^!\[[^\]]*\]\(([^)]+)\)(?:\{width=([\d.]+)cm\})?') {
        $img = $Matches[1]
        $w = if ($Matches[2]) { [double]$Matches[2] } else { 14 }
        $cursor = Add-Image $docObj $cursor $img $w
        $idx++; continue
      }
      # 有序 / 无序列表
      if ($trim -match '^(\d+\.|[-*])\s+(.*)$') {
        $cursor = Add-RichParagraph $docObj $cursor ('　' + $trim) $SIZE_BODY $false
        $idx++; continue
      }
      # 普通段落
      $cursor = Add-RichParagraph $docObj $cursor $trim $SIZE_BODY $false
      $idx++
    }
    return $cursor
  }

  foreach ($pair in @(@{ k = '一'; row = 4 }, @{ k = '二'; row = 5 }, @{ k = '三'; row = 6 })) {
    if (-not $parts.ContainsKey($pair.k)) { continue }
    $c = Fill-Part $doc $tbl $pair.row $parts[$pair.k]
    "第 $($pair.k) 部分已写入（第 $($pair.row) 行单元格）"
  }

  $doc.Save()
  $pages = $doc.ComputeStatistics(2)
  $words = $doc.ComputeStatistics(0)
  $shapes = $doc.InlineShapes.Count
  $doc.Close(0)

  ""
  "================ 生成完成 ================"
  "输出文件：$outPath"
  "页数：$pages　字数：$words　内嵌图片：$shapes"
}
finally {
  $word.Quit()
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
}
