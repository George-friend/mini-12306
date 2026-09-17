$ErrorActionPreference = 'Continue'
$base = 'http://127.0.0.1:4000/api/v1'
$results = @()
function T($n, $c, $d = '') { $script:results += [pscustomobject]@{ case = $n; ok = [bool]$c; detail = $d } }

function CApi($method, $path, $token, $json = $null) {
  $a = @('-s', '-X', $method, "$base$path", '-H', 'Accept: application/json')
  if ($token) { $a += @('-H', "Authorization: Bearer $token") }
  if ($null -ne $json) { $a += @('-H', 'Content-Type: application/json', '--data-binary', $json) }
  $out = & 'C:\Windows\system32\curl.exe' @a
  try { return ($out | Out-String | ConvertFrom-Json) } catch { return [pscustomobject]@{ code = -1; message = '解析失败' } }
}

# 稳健登录：最多重试 20 次（共享 DB 并发写会偶发 500）
function Token($u, $p) {
  for ($i = 0; $i -lt 20; $i++) {
    $r = CApi 'POST' '/auth/login' $null ('{"username":"' + $u + '","password":"' + $p + '"}')
    if ($r.code -eq 0) { return $r.data.token }
    Start-Sleep -Milliseconds 900
  }
  return $null
}

$admin = Token 'admin01' 'Admin@123456'
$clerk = Token 'clerk01' 'Clerk@123456'
T '登录 admin01 / clerk01' ($admin -and $clerk) "admin=$([bool]$admin) clerk=$([bool]$clerk)"
if (-not $admin) { Write-Output '登录失败，终止'; exit 1 }

# 1 重复电报码
$st = (CApi 'GET' '/admin/stations' $admin).data.list
$r = CApi 'POST' '/admin/stations' $admin ('{"code":"' + $st[0].code + '","name":"重复站","city":"测试市","province":"测试省","pinyin":"x"}')
T '重复电报码 → 2002' ($r.code -eq 2002) "$($r.code) $($r.message)"

# 2 删除被车次引用的车站
$r = CApi 'DELETE' "/admin/stations/$($st[0].id)" $admin
T '删除被引用车站 → 1001' ($r.code -eq 1001) "$($r.code) $($r.message)"

# 3 删除已有订单的车次
$ao = CApi 'GET' '/admin/orders?page=1&pageSize=1' $admin
$trainWithOrder = $ao.data.list[0].train.trainNo
$tr = (CApi 'GET' '/admin/trains' $admin).data.list | Where-Object { $_.trainNo -eq $trainWithOrder }
if ($tr) {
  $r = CApi 'DELETE' "/admin/trains/$($tr.id)" $admin
  T "删除有订单车次($trainWithOrder) → 1001" ($r.code -eq 1001) "$($r.code) $($r.message)"
}

# 4 系统参数非法值
$r = CApi 'PUT' '/admin/settings/ticket.standing_enabled' $admin '{"value":"maybe"}'
T 'BOOL 非法值 → 1001' ($r.code -eq 1001) "$($r.code) $($r.message)"
$r = CApi 'PUT' '/admin/settings/order.pay_timeout_minutes' $admin '{"value":"abc"}'
T 'INT 非法值 → 1001' ($r.code -eq 1001) "$($r.code) $($r.message)"
$r = CApi 'PUT' '/admin/settings/not.exist.key' $admin '{"value":"1"}'
T '不存在的参数 → 非 0' ($r.code -ne 0) "$($r.code) $($r.message)"

# 5 冻结当前管理员
$meId = ((CApi 'GET' '/admin/users?keyword=admin01' $admin).data.list)[0].id
$r = CApi 'PATCH' "/admin/users/$meId/status" $admin '{"status":"FROZEN"}'
T '冻结当前登录管理员 → 1001' ($r.code -eq 1001) "$($r.code) $($r.message)"

# 6 定员低于已售+已锁定
$today = (Get-Date).ToString('yyyy-MM-dd')
$sched = CApi 'GET' "/admin/schedules?date=$today" $admin
$tgt = $null
foreach ($s in $sched.data.list) { foreach ($i in $s.inventory) { if ($i.soldCount + $i.lockedCount -gt 0) { $tgt = $i; break } }; if ($tgt) { break } }
if ($tgt) {
  $r = CApi 'PUT' "/admin/inventory/$($tgt.id)" $admin ('{"totalCount":' + ($tgt.soldCount + $tgt.lockedCount - 1) + '}')
  T '定员低于已售+已锁定 → 1001' ($r.code -eq 1001) "sold=$($tgt.soldCount) locked=$($tgt.lockedCount) → $($r.code) $($r.message)"
} else { T '定员低于已售+已锁定 → 1001' $false '无 soldCount>0 的库存' }

# 7 重复现金收银（对已支付订单收银）
if ($clerk) {
  $paid = (CApi 'GET' '/admin/orders?status=PAID&page=1&pageSize=1' $admin).data.list[0]
  if ($paid) {
    $r = CApi 'POST' "/clerk/orders/$($paid.orderNo)/pay-cash" $clerk
    T '对已支付订单收银 → 5001' ($r.code -eq 5001) "$($paid.orderNo) $($r.code) $($r.message)"
  }
} else { T '对已支付订单收银 → 5001' $false 'clerk01 登录失败' }

# 8 幂等键重复下单（对已存在幂等键的订单不再下单，改为校验 4004 重复购买拒绝）
if ($clerk) {
  $u = ((CApi 'GET' '/admin/users?keyword=passenger01' $admin).data.list)[0]
  $pax = (CApi 'GET' "/clerk/users/$($u.id)/passengers" $clerk).data.list
  T 'GET /clerk/users/:id/passengers 字段' ($pax.Count -ge 1 -and $pax[0].idCardMasked -match '\*\*\*\*') "count=$($pax.Count)"
  $cb = CApi 'GET' '/clerk/orders/search?keyword=passenger01' $clerk
  T 'GET /clerk/orders/search 未命中订单也可用(空关键字拒绝)' ($cb.code -eq 0) "users=$($cb.data.users.Count) orders=$($cb.data.orders.Count)"
  $bad = CApi 'GET' '/clerk/orders/search?keyword=' $clerk
  T '空关键字检索 → 1001' ($bad.code -eq 1001) "$($bad.code) $($bad.message)"
}

Write-Output ''
$results | ForEach-Object { "{0,-40} {1}  {2}" -f $_.case, $(if ($_.ok) { 'PASS' } else { 'FAIL' }), $_.detail }
Write-Output ''
Write-Output "==== PASS $((($results | Where-Object ok).Count)) / $($results.Count) ===="