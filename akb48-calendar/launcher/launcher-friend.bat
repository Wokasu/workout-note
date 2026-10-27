@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0launcher.ps1" -Links https://raw.githubusercontent.com/Wokasu/workout-note/akb48-calendar-feed-friend/links.json %*
