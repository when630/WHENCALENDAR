# OVL-02 regression check: does the overlay stay above a fullscreen TopMost window?
#
#   1) npm start          (leave the overlay running)
#   2) powershell -NoProfile -ExecutionPolicy Bypass -File verify-fullscreen.ps1
#   3) open fs.png - the island must be visible at the top centre
#
# A borderless maximized TopMost window is what a fullscreen IDE or browser looks
# like to Windows. Exclusive-fullscreen games are NOT covered by this check.
# ASCII only - PowerShell 5.1 reads BOM-less UTF-8 as cp949.
param([string]$Out = "fs.png", [int]$Hold = 4)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$f = New-Object System.Windows.Forms.Form
$f.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$f.WindowState     = [System.Windows.Forms.FormWindowState]::Maximized
$f.TopMost         = $true
$f.BackColor       = [System.Drawing.Color]::FromArgb(24, 90, 160)
$f.ShowInTaskbar   = $false

$lbl = New-Object System.Windows.Forms.Label
$lbl.Text      = "FULLSCREEN / TOPMOST TEST WINDOW"
$lbl.Font      = New-Object System.Drawing.Font("Segoe UI", 34, [System.Drawing.FontStyle]::Bold)
$lbl.ForeColor = [System.Drawing.Color]::White
$lbl.AutoSize  = $true
$lbl.Location  = New-Object System.Drawing.Point(90, 300)
$f.Controls.Add($lbl)

$f.Show()
$f.Activate()
for ($i = 0; $i -lt 40; $i++) {
  [System.Windows.Forms.Application]::DoEvents()
  Start-Sleep -Milliseconds 100
}
Start-Sleep -Seconds $Hold
[System.Windows.Forms.Application]::DoEvents()

$b   = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
$g   = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()

$f.Close(); $f.Dispose()
Write-Output ("saved {0}" -f $Out)
