$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) { throw 'Windows .NET Framework C# compiler is required.' }
$dist = Join-Path $projectRoot 'dist'
New-Item -ItemType Directory -Path $dist -Force | Out-Null
& (Join-Path $PSScriptRoot 'create-windows-icon.ps1') | Out-Null
& $compiler /nologo /target:winexe "/out:$(Join-Path $dist 'Angela.exe')" "/win32icon:$(Join-Path $projectRoot 'windows\Angela.ico')" /r:System.Windows.Forms.dll /r:System.Drawing.dll (Join-Path $projectRoot 'windows\Program.cs')
if ($LASTEXITCODE -ne 0) { throw 'Angela.exe compilation failed.' }

$bundle = Join-Path $dist 'Angela-Windows'
New-Item -ItemType Directory -Path $bundle -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $dist 'Angela.exe') -Destination $bundle -Force
$nodeSource = if ($env:ANGELA_NODE) { $env:ANGELA_NODE } else { (Get-Command node -ErrorAction Stop).Source }
Copy-Item -LiteralPath $nodeSource -Destination (Join-Path $bundle 'node.exe') -Force
Get-ChildItem -LiteralPath $projectRoot -Filter '*.mjs' -File | Copy-Item -Destination $bundle -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'public') -Destination $bundle -Recurse -Force
New-Item -ItemType Directory -Path (Join-Path $bundle 'scripts') -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot 'scripts\convert-xls.ps1') -Destination (Join-Path $bundle 'scripts') -Force
New-Item -ItemType Directory -Path (Join-Path $bundle 'dist') -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $dist 'Angela-offline-android.apk') -Destination (Join-Path $bundle 'dist') -Force
$archive = Join-Path $dist 'Angela-Windows-20260928.zip'
Compress-Archive -Path (Join-Path $bundle '*') -DestinationPath $archive -Force
Write-Output "Angela.exe: $(Join-Path $dist 'Angela.exe')"
Write-Output "Portable folder: $bundle"
Write-Output "Portable archive: $archive"
