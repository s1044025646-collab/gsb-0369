$srv = Start-Process node -ArgumentList "dist/src/cli.js serve --port=18093" -PassThru -WindowStyle Hidden
Start-Sleep 1.5
$b = "http://127.0.0.1:18093"
$r1 = Invoke-RestMethod -Method Post -Uri "$b/grids" -ContentType "application/json" -Body '{"rows":3,"cols":4,"sources":[[1,1]]}'
$id = $r1.id
"created id=$id"
Invoke-RestMethod -Method Post -Uri "$b/grids/$id/compute" | ConvertTo-Json -Compress
Invoke-RestMethod -Uri "$b/grids/${id}/cell?r=0&c=3" | ConvertTo-Json -Compress
(Invoke-RestMethod -Uri "$b/grids/${id}/explain?r=0&c=3").pass2.envelope | ConvertTo-Json -Compress
$v2 = Invoke-RestMethod -Method Post -Uri "$b/grids/$id/sources" -ContentType "application/json" -Body '{"add":[[0,3]]}'
"derived id=$($v2.id) parent=$($v2.parentId)"
Invoke-RestMethod -Method Post -Uri "$b/grids/$($v2.id)/compute" | Out-Null
Invoke-WebRequest -Uri "$b/grids/$($v2.id)/export" | Select-Object -ExpandProperty Content
try { Invoke-RestMethod -Uri "$b/grids/99/cell?r=0&c=0" } catch { $_.ErrorDetails.Message }
try { Invoke-RestMethod -Method Post -Uri "$b/grids" -ContentType "application/json" -Body '{"data":[[0,2]]}' } catch { $_.ErrorDetails.Message }
try { Invoke-RestMethod -Uri "$b/grids/$id/result" } catch { $_.ErrorDetails.Message }
Stop-Process -Id $srv.Id -Force
