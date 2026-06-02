param([int]$Port = 8767)

$rootPath = $PSScriptRoot
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Quest-Failed dev server running at http://localhost:$Port"
Write-Host "Serving from: $rootPath"

$mimeTypes = @{
    '.html' = 'text/html; charset=utf-8'
    '.js'   = 'application/javascript; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'
    '.png'  = 'image/png'
    '.jpg'  = 'image/jpeg'
    '.gif'  = 'image/gif'
    '.svg'  = 'image/svg+xml'
    '.ico'  = 'image/x-icon'
    '.ttf'  = 'font/ttf'
    '.woff' = 'font/woff'
    '.woff2'= 'font/woff2'
    '.mp4'  = 'video/mp4'
    '.webm' = 'video/webm'
    '.mp3'  = 'audio/mpeg'
    '.wav'  = 'audio/wav'
}

while ($listener.IsListening) {
    try {
        $context  = $listener.GetContext()
        $request  = $context.Request
        $response = $context.Response

        $localPath = $request.Url.LocalPath.TrimStart('/')
        if ($localPath -eq '') { $localPath = 'index.html' }

        $filePath = Join-Path $rootPath $localPath

        if (Test-Path $filePath -PathType Leaf) {
            $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
            $response.ContentType = if ($mimeTypes[$ext]) { $mimeTypes[$ext] } else { 'application/octet-stream' }
            # Cache the heavy binary assets (textures/audio/fonts/video) hard:
            # they never change mid-session, and re-fetching them all on every
            # reload is what stalls this single-threaded server (the "boot wedges
            # at ~7 textures" bug). Code (html/js/css/json) stays no-cache so
            # live edits still show on reload.
            $binaryExts = @('.png','.jpg','.gif','.svg','.ico','.ttf','.woff','.woff2','.mp4','.webm','.mp3','.wav')
            if ($binaryExts -contains $ext) {
                $response.Headers.Add('Cache-Control', 'public, max-age=86400, immutable')
            } else {
                $response.Headers.Add('Cache-Control', 'no-cache')
            }
            $content = [System.IO.File]::ReadAllBytes($filePath)
            $response.ContentLength64 = $content.Length
            $response.OutputStream.Write($content, 0, $content.Length)
            $response.StatusCode = 200
        } else {
            $body = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found: $localPath")
            $response.ContentType = 'text/plain'
            $response.StatusCode  = 404
            $response.ContentLength64 = $body.Length
            $response.OutputStream.Write($body, 0, $body.Length)
        }

        $response.Close()
    } catch {
        if ($listener.IsListening) { Write-Warning "Server error: $_" }
    }
}

$listener.Stop()
