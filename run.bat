@echo off
chcp 65001 >nul
cd /d "%~dp0"

where py >nul 2>nul
if %errorlevel%==0 (
    py -3 server.py
    goto :eof
)

where python >nul 2>nul
if %errorlevel%==0 (
    python server.py
    goto :eof
)

echo 未检测到 Python 3。
echo 请安装 Python 3.9 或更高版本，并勾选 Add Python to PATH。
pause
