@echo off
REM ============================================================
REM  一键重新压缩（改了 api.js/app.js/data.js/charts.js/styles.css 源码后运行）
REM  说明：terser 装在 WorkBuddy 自带的 node 里，路径写死如下。
REM        若换电脑，请把 NODE / TS 两行改成你机器上的 node.exe 与 terser 路径。
REM ============================================================
set NODE=C:\Users\Administrator\.workbuddy\binaries\node\versions\22.22.2\node.exe
set TS=C:\Users\Administrator\.workbuddy\binaries\node\versions\22.22.2\node_modules\terser\bin\terser

"%NODE%" "%TS%" js/api.js    -c -m -o js/api.min.js
"%NODE%" "%TS%" js/app.js    -c -m -o js/app.min.js
"%NODE%" "%TS%" js/data.js   -c -m -o js/data.min.js
"%NODE%" "%TS%" js/charts.js -c -m -o js/charts.min.js

REM CSS：去注释 + 折叠空白（terser 不处理 CSS，故用 node 内联脚本）
"%NODE%" -e "const fs=require('fs');let s=fs.readFileSync('styles.css','utf8');s=s.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\s*([{}:;,])\s*/g,'$1').replace(/;}/g,'}').replace(/\s+/g,' ').trim();fs.writeFileSync('styles.min.css',s);"

echo.
echo [OK] 已重新生成 4 个 .min.js + styles.min.css
echo      如需推 GitHub Pages，记得 git push。
pause
