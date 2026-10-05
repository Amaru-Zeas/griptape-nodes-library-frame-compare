param([string]$FFmpeg = 'ffmpeg')
$destination = Join-Path $PSScriptRoot 'fixtures'
New-Item -ItemType Directory -Force $destination | Out-Null
& $FFmpeg -hide_banner -loglevel error -y -f lavfi -i 'testsrc2=size=640x360:rate=24:duration=5' -an -c:v libvpx -deadline realtime -b:v 700k (Join-Path $destination 'plate.webm')
if ($LASTEXITCODE) { throw 'Could not create plate fixture' }
& $FFmpeg -hide_banner -loglevel error -y -f lavfi -i 'color=black:size=640x360:rate=24:duration=7' -vf 'drawbox=x=320:y=0:w=320:h=360:color=white:t=fill' -an -c:v libvpx -deadline realtime -b:v 100k (Join-Path $destination 'mask.webm')
if ($LASTEXITCODE) { throw 'Could not create mask fixture' }
